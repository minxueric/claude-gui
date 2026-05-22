import { useState, useMemo } from "react";
import { MessageRow, formatTime } from "../lib/api";
import MarkdownBlock from "./blocks/MarkdownBlock";
import ThinkingBlock from "./blocks/ThinkingBlock";
import ToolUseCard from "./blocks/ToolUseCard";
import ToolResultCard from "./blocks/ToolResultCard";
import EditDiffBlock from "./blocks/EditDiffBlock";

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

interface StepItem {
  kind: "tool_use" | "tool_result" | "thinking" | "text";
  block: any;
  rowIdx: number;
  blockIdx: number;
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

export default function HistoryAssistantGroup({ rows, cwd }: { rows: MessageRow[]; cwd?: string }) {
  const steps: StepItem[] = useMemo(() => {
    const out: StepItem[] = [];
    rows.forEach((row, ri) => {
      const content = row.raw?.message?.content;
      if (typeof content === "string") {
        out.push({ kind: "text", block: { type: "text", text: content }, rowIdx: ri, blockIdx: 0 });
      } else if (Array.isArray(content)) {
        content.forEach((b: any, bi: number) => {
          if (!b || typeof b !== "object") return;
          if (b.type === "tool_use") out.push({ kind: "tool_use", block: b, rowIdx: ri, blockIdx: bi });
          else if (b.type === "tool_result") out.push({ kind: "tool_result", block: b, rowIdx: ri, blockIdx: bi });
          else if (b.type === "thinking") out.push({ kind: "thinking", block: b, rowIdx: ri, blockIdx: bi });
          else if (b.type === "text") out.push({ kind: "text", block: b, rowIdx: ri, blockIdx: bi });
        });
      }
    });
    return out;
  }, [rows]);

  const lastTextIdx = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].kind === "text" && (steps[i].block?.text || "").trim().length > 0) return i;
    }
    return -1;
  }, [steps]);

  const stepCount = steps.filter((s) => s.kind === "tool_use" || s.kind === "tool_result" || s.kind === "thinking").length;
  const model = rows.find((r) => r.model)?.model;
  const ts = rows[0]?.ts;
  const tokensIn = rows.reduce((sum, r) => sum + (r.tokensIn || 0), 0);
  const tokensOut = rows.reduce((sum, r) => sum + (r.tokensOut || 0), 0);

  const [groupOpen, setGroupOpen] = useState(true);
  const [openMap, setOpenMap] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setOpenMap((m) => ({ ...m, [i]: !m[i] }));

  return (
    <article className="px-6 py-4 flex gap-3">
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
              <span className="font-mono text-[11px] text-gray-400">
                · {stepCount} step{stepCount === 1 ? "" : "s"}
              </span>
            )}
            {model && <span className="font-mono text-[11px] text-gray-400">· {model}</span>}
            <span className="text-gray-400 text-[10px]">{groupOpen ? "▾" : "▸"}</span>
          </button>
          <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-gray-400">
            {(tokensIn > 0 || tokensOut > 0) && <span>↓{tokensIn} ↑{tokensOut}</span>}
            {ts != null && <span>{formatTime(ts)}</span>}
          </div>
        </header>

      {groupOpen && (
        <div className="border-l-2 border-gray-100 pl-4">
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const isLastText = i === lastTextIdx;

              if (s.kind === "text") {
                if (isLastText) {
                  return (
                    <li key={i} className="pt-1">
                      <MarkdownBlock text={s.block?.text || ""} />
                    </li>
                  );
                }
                const txt = s.block?.text || "";
                const first = txt.split("\n").find((l: string) => l.trim().length > 0) || "";
                const preview = first.length > 120 ? first.slice(0, 120) + "…" : first;
                const open = !!openMap[i];
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggle(i)}
                      className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-50 transition-colors rounded-md px-1"
                    >
                      <span className="font-mono text-[10px] text-gray-400 shrink-0">¶</span>
                      <span className="flex-1 truncate text-[12px] text-gray-500 italic">{preview}</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="pl-5 py-1">
                        <MarkdownBlock text={txt} />
                      </div>
                    )}
                  </li>
                );
              }

              if (s.kind === "thinking") {
                const open = !!openMap[i];
                const t = s.block?.thinking || "";
                const first = t.split("\n").find((l: string) => l.trim().length > 0) || "";
                const preview = first.length > 100 ? first.slice(0, 100) + "…" : first;
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggle(i)}
                      className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-50 transition-colors rounded-md px-1"
                    >
                      <span className="font-mono text-[10px] text-gray-400 shrink-0">✻</span>
                      <span className="flex-1 truncate text-[11.5px] text-gray-400 italic">{preview}</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="pl-5 py-1">
                        <ThinkingBlock text={t} />
                      </div>
                    )}
                  </li>
                );
              }

              if (s.kind === "tool_use") {
                const b = s.block;
                const name = b.name || "tool";
                const isDiff = DIFF_TOOLS.has(name);
                const open = !!openMap[i];
                const preview = isDiff
                  ? (typeof b.input?.file_path === "string" ? b.input.file_path : name)
                  : toolPreview(name, b.input);
                const inputStr = (() => {
                  try { return JSON.stringify(b.input, null, 2); } catch { return String(b.input); }
                })();
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggle(i)}
                      className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-50 transition-colors rounded-md px-1"
                    >
                      <span className="text-orange-500 font-mono text-[11px] shrink-0">⚙ {name}</span>
                      <span className="flex-1 truncate font-mono text-[11px] text-gray-500">{preview}</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      isDiff ? (
                        <div className="mt-1">
                          <EditDiffBlock name={name} input={b.input} cwd={cwd} />
                        </div>
                      ) : (
                        <pre className="mt-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
{inputStr}
                        </pre>
                      )
                    )}
                  </li>
                );
              }

              if (s.kind === "tool_result") {
                const b = s.block;
                const { line, lineCount, chars, text } = resultPreview(b.content);
                const open = !!openMap[i];
                const isErr = !!b.is_error;
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggle(i)}
                      className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-50 transition-colors rounded-md px-1"
                    >
                      <span className={"font-mono text-[10.5px] shrink-0 " + (isErr ? "text-red-400" : "text-amber-500")}>
                        ↳ {isErr ? "error" : "result"}
                      </span>
                      <span className="flex-1 truncate font-mono text-[11px] text-gray-500">{line}</span>
                      <span className="font-mono text-[10px] text-gray-400 shrink-0">{lineCount} ln · {chars}c</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <pre className={"mt-1 px-3 py-2 rounded-lg border text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed " + (isErr ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-700")}>
{text}
                    </pre>
                    )}
                  </li>
                );
              }

              return null;
            })}
          </ol>
        </div>
      )}
      </div>
    </article>
  );
}
