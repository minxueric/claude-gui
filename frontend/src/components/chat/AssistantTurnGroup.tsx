import { useState, useMemo } from "react";
import { ChatTurn, ChatBlock, PermissionRequest } from "../../hooks/useChatStream";
import MarkdownBlock from "../blocks/MarkdownBlock";
import ThinkingBlock from "../blocks/ThinkingBlock";
import EditDiffBlock from "../blocks/EditDiffBlock";
import PermissionPrompt from "./PermissionPrompt";
import { useFilePreview } from "./FilePreviewContext";

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

interface Props {
  turns: ChatTurn[];   // consecutive non-user turns
  cwd?: string;
  pending?: PermissionRequest;
  onDecide?: (d: "allow" | "deny" | "allow_once", message?: string) => void;
}

interface StepItem {
  kind: "tool_use" | "tool_result" | "thinking" | "text" | "system" | "result";
  block?: ChatBlock;
  text?: string;          // for system/result synthetic items
  role?: ChatTurn["role"];
  turnIdx: number;        // which turn it came from (within this group)
  blockIdx: number;       // which block within that turn
  resultBlock?: ChatBlock; // for tool_use: the paired tool_result (if seen)
}

function toolPreview(name: string | undefined, input: any): string {
  if (input && typeof input === "object") {
    if (typeof input.command === "string") return input.command;
    if (typeof input.file_path === "string") return input.file_path;
    if (typeof input.pattern === "string") return input.pattern;
    if (typeof input.prompt === "string") return input.prompt.slice(0, 120);
    if (typeof input.path === "string") return input.path;
  }
  try {
    const s = JSON.stringify(input);
    return s.length > 100 ? s.slice(0, 100) + "…" : s;
  } catch {
    return name || "";
  }
}

function resultPreview(content: any): { line: string; lineCount: number; chars: number; text: string } {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : JSON.stringify(b)))
      .join("\n");
  } else {
    try { text = JSON.stringify(content, null, 2); } catch { text = String(content); }
  }
  const first = text.split("\n").find((l) => l.trim().length > 0) || "";
  const line = first.length > 100 ? first.slice(0, 100) + "…" : first;
  const lineCount = text ? text.split("\n").length : 0;
  return { line, lineCount, chars: text.length, text };
}

export default function AssistantTurnGroup({ turns, cwd, pending, onDecide }: Props) {
  const filePreview = useFilePreview();
  const steps: StepItem[] = useMemo(() => {
    const out: StepItem[] = [];
    // First pass: collect tool_use_id → tool_result_block for pairing
    const resultsById = new Map<string, ChatBlock>();
    turns.forEach((t) => {
      t.blocks?.forEach((b) => {
        if (b.type === "tool_result" && b.tool_use_id) {
          resultsById.set(b.tool_use_id, b);
        }
      });
    });
    // Second pass: emit steps; attach paired result to each tool_use
    turns.forEach((t, ti) => {
      if (t.role === "system" || t.role === "result") {
        out.push({
          kind: t.role,
          text: t.blocks?.[0]?.text || "",
          role: t.role,
          turnIdx: ti,
          blockIdx: 0,
        });
        return;
      }
      t.blocks.forEach((b, bi) => {
        if (b.type === "tool_use") {
          out.push({
            kind: "tool_use",
            block: b,
            turnIdx: ti,
            blockIdx: bi,
            resultBlock: b.id ? resultsById.get(b.id) : undefined,
          });
        } else if (b.type === "tool_result") {
          // skip — already attached to its tool_use above
        } else if (b.type === "thinking") {
          out.push({ kind: "thinking", block: b, turnIdx: ti, blockIdx: bi });
        } else if (b.type === "text") {
          out.push({ kind: "text", block: b, turnIdx: ti, blockIdx: bi });
        }
      });
    });
    return out;
  }, [turns]);


  const stepCount = steps.filter((s) => s.kind === "tool_use" || s.kind === "thinking").length;
  const model = turns.find((t) => t.model)?.model;

  // Group-level collapse: default expanded so user sees activity in progress
  const [groupOpen, setGroupOpen] = useState(true);
  // Per-step expansion for tool_use / tool_result / thinking / intermediate text
  const [openMap, setOpenMap] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setOpenMap((m) => ({ ...m, [i]: !m[i] }));

  return (
    <article className="px-6 py-4 flex gap-3">
      {/* Claude avatar */}
      <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L13 5.5V10.5L8 14L3 10.5V5.5L8 2Z" fill="white" fillOpacity="0.95"/>
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setGroupOpen(!groupOpen)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-[13px] font-semibold text-gray-900">Claude</span>
            {stepCount > 0 && (
              <span className="text-[11px] text-gray-400 font-mono">
                · {stepCount} step{stepCount === 1 ? "" : "s"}
              </span>
            )}
            {model && <span className="text-[11px] text-gray-400 font-mono">· {model}</span>}
            <span className="text-gray-400 text-[10px]">{groupOpen ? "▾" : "▸"}</span>
          </button>
        </header>

      {groupOpen && (
        <div className="space-y-3">
          {(() => {
            // Bucket consecutive tool_use / thinking into "tool blocks" (secondary visual layer);
            // text blocks render as primary markdown paragraphs.
            const buckets: Array<{ kind: "tools"; items: { step: StepItem; index: number }[] } | { kind: "text"; step: StepItem; index: number }> = [];
            let toolBuffer: { step: StepItem; index: number }[] = [];
            const flushTools = () => {
              if (toolBuffer.length === 0) return;
              buckets.push({ kind: "tools", items: toolBuffer });
              toolBuffer = [];
            };
            steps.forEach((s, i) => {
              if (s.kind === "system" || s.kind === "result") return;
              if (s.kind === "text") {
                const txt = s.block?.text || "";
                if (!txt.trim()) return; // skip empty text noise
                flushTools();
                buckets.push({ kind: "text", step: s, index: i });
              } else {
                toolBuffer.push({ step: s, index: i });
              }
            });
            flushTools();

            const renderToolItem = (s: StepItem, i: number) => {
              if (s.kind === "thinking") {
                const open = !!openMap[i];
                const t = s.block?.thinking || "";
                const first = t.split("\n").find((l) => l.trim().length > 0) || "";
                const preview = first.length > 100 ? first.slice(0, 100) + "…" : first;
                return (
                  <div key={i}>
                    <button
                      onClick={() => toggle(i)}
                      className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-white/60 transition-colors rounded-md px-1"
                    >
                      <span className="font-mono text-[10px] text-gray-400 shrink-0">✻</span>
                      <span className="flex-1 truncate text-[11.5px] text-gray-500 italic">{preview}</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="pl-5 py-1">
                        <ThinkingBlock text={t} />
                      </div>
                    )}
                  </div>
                );
              }
              if (s.kind === "tool_use") {
                const b = s.block!;
                const name = b.name || "tool";
                const isDiff = DIFF_TOOLS.has(name);
                const open = !!openMap[i];
                const preview = isDiff
                  ? (typeof b.input?.file_path === "string" ? b.input.file_path : name)
                  : toolPreview(name, b.input);
                const inputStr = (() => {
                  try { return JSON.stringify(b.input, null, 2); } catch { return String(b.input); }
                })();
                // Detect file_path / path for clickable preview link
                const filePath: string | undefined =
                  typeof b.input?.file_path === "string" ? b.input.file_path :
                  typeof b.input?.path === "string" ? b.input.path :
                  typeof b.input?.notebook_path === "string" ? b.input.notebook_path :
                  undefined;
                const canPreview = !!filePath && !!cwd && !!filePreview;
                const resultBlock = s.resultBlock;
                const resultInfo = resultBlock ? resultPreview(resultBlock.content) : null;
                const isResultErr = !!resultBlock?.is_error;
                const resultKey = `r${i}`;
                const resultOpen = !!openMap[resultKey as any];
                return (
                  <div key={i}>
                    <div className="flex items-center gap-2 py-0.5 hover:bg-white/60 transition-colors rounded-md px-1">
                      <button onClick={() => toggle(i)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <span className="text-orange-500 font-mono text-[11px] shrink-0">⚙ {name}</span>
                        {canPreview ? (
                          <span
                            onClick={(e) => { e.stopPropagation(); filePreview!.open({ cwd: cwd!, path: filePath! }); }}
                            className="flex-1 truncate font-mono text-[11px] text-blue-600 hover:underline cursor-pointer"
                            title="Click to preview file"
                          >
                            {preview}
                          </span>
                        ) : (
                          <span className="flex-1 truncate font-mono text-[11px] text-gray-600">{preview}</span>
                        )}
                        <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                      </button>
                    </div>
                    {open && (
                      isDiff ? (
                        <div className="mt-1">
                          <EditDiffBlock name={name} input={b.input} cwd={cwd} />
                        </div>
                      ) : (
                        <pre className="mt-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
{inputStr}
                        </pre>
                      )
                    )}
                    {resultInfo && (
                      <>
                        <button
                          onClick={() => setOpenMap((m) => ({ ...m, [resultKey]: !m[resultKey as any] }))}
                          className="w-full text-left flex items-center gap-2 py-0.5 pl-4 hover:bg-white/60 transition-colors rounded-md"
                        >
                          <span className={"font-mono text-[11px] shrink-0 " + (isResultErr ? "text-red-400" : "text-gray-400")}>⎿</span>
                          <span className={"flex-1 truncate font-mono text-[11px] " + (isResultErr ? "text-red-500" : "text-gray-600")}>{resultInfo.line || "(empty)"}</span>
                          <span className="font-mono text-[10px] text-gray-400 shrink-0">{resultInfo.lineCount} ln</span>
                          <span className="text-gray-400 text-[10px] shrink-0">{resultOpen ? "▾" : "▸"}</span>
                        </button>
                        {resultOpen && (
                          <pre className={"mt-1 ml-4 px-3 py-2 rounded-lg border text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed " + (isResultErr ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-700")}>
{resultInfo.text}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                );
              }
              return null;
            };

            return buckets.map((bk, bi) => {
              if (bk.kind === "text") {
                return (
                  <div key={`t-${bi}`} className="text-gray-900">
                    <MarkdownBlock text={bk.step.block?.text || ""} />
                  </div>
                );
              }
              // tools bucket: collapsible secondary panel
              const isLastBucket = bi === buckets.length - 1;
              const bucketKey = `bk-${bi}`;
              const bucketOpen = openMap[bucketKey as any] ?? isLastBucket; // last group expanded by default
              // Group tool calls by name for a CLI-style summary
              const toolCounts = new Map<string, number>();
              let thinkCount = 0;
              for (const x of bk.items) {
                if (x.step.kind === "thinking") thinkCount++;
                else if (x.step.kind === "tool_use") {
                  const n = x.step.block?.name || "tool";
                  toolCounts.set(n, (toolCounts.get(n) || 0) + 1);
                }
              }
              const NOUN: Record<string, string> = {
                Read: "file", Write: "file", Edit: "file", MultiEdit: "file",
                Glob: "pattern", Grep: "search",
                Bash: "command", BashOutput: "stream", KillShell: "shell",
                WebFetch: "page", WebSearch: "query",
                Task: "task", TaskCreate: "task", TaskUpdate: "task", TaskList: "lookup", TaskGet: "lookup",
                TodoWrite: "todo",
                NotebookEdit: "cell",
                Agent: "agent",
              };
              const summaryParts: string[] = [];
              for (const [name, n] of toolCounts) {
                const noun = NOUN[name] || "call";
                summaryParts.push(`${name} ${n} ${noun}${n === 1 ? "" : "s"}`);
              }
              if (thinkCount) summaryParts.push(`${thinkCount} thought${thinkCount === 1 ? "" : "s"}`);
              return (
                <div key={`bk-${bi}`} className="rounded-lg border border-gray-150 bg-gray-50/60">
                  <button
                    onClick={() => setOpenMap((m) => ({ ...m, [bucketKey]: !(m[bucketKey as any] ?? isLastBucket) }))}
                    className="w-full text-left flex items-center gap-2 px-2 py-1 hover:bg-gray-100/50 transition-colors rounded-t-lg"
                  >
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">Tools</span>
                    <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0">· {summaryParts.join(" · ")}</span>
                    <span className="text-gray-400 text-[10px] shrink-0">{bucketOpen ? "▾" : "▸"}</span>
                  </button>
                  {bucketOpen && (
                    <div className="px-2 pb-1.5 space-y-0.5">
                      {bk.items.map(({ step, index }) => renderToolItem(step, index))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
          {pending && onDecide && (
            <ol className="space-y-1">
              <PermissionPrompt req={pending} onDecide={onDecide} cwd={cwd} />
            </ol>
          )}
        </div>
      )}
      </div>
    </article>
  );
}
