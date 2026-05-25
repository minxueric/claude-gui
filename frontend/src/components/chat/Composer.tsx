import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { api, FileMatch, SlashCommand } from "../../lib/api";
import { useSlashCommands, filterCommands } from "../../hooks/useSlashCommands";
import { useCwdFileMatch } from "../../hooks/useCwdFiles";
import { ChatBlock } from "../../hooks/useChatStream";
import SlashCommandMenu from "./SlashCommandMenu";
import FileMentionMenu from "./FileMentionMenu";

interface ImagePayload {
  id: string;
  mediaType: string;
  dataUrl: string;
  base64: string;
  bytes: number;
  name?: string;
}

interface Props {
  cwd: string;
  mode: string;
  onCycleMode: () => void;            // kept for Shift+Tab shortcut
  onSelectMode?: (mode: string) => void; // explicit dropdown selection
  effort?: string;
  onSelectEffort?: (effort: string) => void;
  model?: string;
  onSelectModel?: (model: string) => void;
  onSend: (content: string | ChatBlock[]) => void | Promise<void>;
  status?: "idle" | "open" | "running" | "done" | "error";
  onInterrupt?: () => void | Promise<void>;
}

function detectTrigger(text: string, caret: number): { kind: "/" | "@" | "!" | "#"; query: string; start: number } | null {
  if (caret <= 0) return null;
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "\n" || ch === " " || ch === "\t") return null;
    if (ch === "/" || ch === "@" || ch === "!" || ch === "#") {
      const isAtStart = i === 0 || text[i - 1] === "\n" || text[i - 1] === " " || text[i - 1] === "\t";
      if (ch === "@") {
        if (!isAtStart) return null;
        return { kind: ch, query: text.slice(i + 1, caret), start: i };
      }
      if (!isAtStart) return null;
      const lineStart = text.lastIndexOf("\n", i - 1) + 1;
      const between = text.slice(lineStart, i);
      if (between.trim().length > 0) return null;
      return { kind: ch as any, query: text.slice(i + 1, caret), start: i };
    }
    i--;
  }
  return null;
}

const IMAGE_MAX = 5 * 1024 * 1024;
const TOTAL_MAX = 20 * 1024 * 1024;

async function fileToImagePayload(file: File): Promise<ImagePayload | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > IMAGE_MAX) return null;
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  return {
    id: crypto.randomUUID(),
    mediaType: file.type || "image/png",
    dataUrl: `data:${file.type || "image/png"};base64,${base64}`,
    base64,
    bytes: file.size,
    name: file.name,
  };
}

export interface ComposerHandle {
  injectMention: (path: string) => void;
  focus: () => void;
}

function ComposerImpl(
  { cwd, mode, onCycleMode, onSelectMode, effort, onSelectEffort, model, onSelectModel, onSend, status, onInterrupt }: Props,
  ref: React.Ref<ComposerHandle>
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<ImagePayload[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [trigger, setTrigger] = useState<ReturnType<typeof detectTrigger>>(null);
  const [memoStatus, setMemoStatus] = useState<string | null>(null);
  const isComposing = useRef(false);

  const slashQ = trigger?.kind === "/" ? trigger.query : "";
  const fileQ = trigger?.kind === "@" ? trigger.query : "";

  const { data: cmds } = useSlashCommands(cwd);
  const filteredCmds = useMemo(() => filterCommands(cmds, slashQ), [cmds, slashQ]);
  const { data: fileMatches } = useCwdFileMatch(cwd, fileQ, trigger?.kind === "@");

  const items: SlashCommand[] | FileMatch[] = trigger?.kind === "/" ? filteredCmds : (fileMatches || []);

  useEffect(() => { setActiveIdx(0); }, [trigger?.kind, trigger?.query]);

  const totalBytes = images.reduce((a, b) => a + b.bytes, 0);

  const insertAtCaret = (insert: string, replaceStart?: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? draft.length;
    const start = replaceStart ?? caret;
    const next = draft.slice(0, start) + insert + draft.slice(caret);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
      setTrigger(detectTrigger(next, pos));
    });
  };

  useImperativeHandle(ref, () => ({
    injectMention: (path: string) => {
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? draft.length;
      const needsLeadSpace = caret > 0 && !/[\s]/.test(draft.slice(caret - 1, caret));
      const token = `${needsLeadSpace ? " " : ""}@${path} `;
      insertAtCaret(token);
    },
    focus: () => { taRef.current?.focus(); },
  }), [draft]);

  const pickSlash = useCallback((c: SlashCommand) => {
    if (!trigger) return;
    setTrigger(null);

    // Built-in commands have no body — send the slash command directly
    if (c.scope === "builtin") {
      setDraft("");
      onSend(`/${c.name}`);
      return;
    }

    // User/project commands: expand body into the draft
    const body = (c.body || "").replace(/\$ARGUMENTS/g, "").trimEnd();
    const before = draft.slice(0, trigger.start);
    const after = draft.slice((taRef.current?.selectionStart) ?? draft.length);
    const next = before + body + after;
    setDraft(next);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const pos = (before + body).length;
      ta.setSelectionRange(pos, pos);
    });
  }, [draft, trigger, onSend]);

  const pickFile = useCallback((m: FileMatch) => {
    if (!trigger) return;
    const before = draft.slice(0, trigger.start);
    const after = draft.slice((taRef.current?.selectionStart) ?? draft.length);
    const token = `@${m.path}` + (after.startsWith(" ") || after === "" ? "" : " ");
    const next = before + token + after;
    setDraft(next);
    setTrigger(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const pos = (before + token).length;
      ta.setSelectionRange(pos, pos);
    });
  }, [draft, trigger]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    const caret = e.target.selectionStart ?? v.length;
    setTrigger(detectTrigger(v, caret));
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    setTrigger(detectTrigger(ta.value, ta.selectionStart ?? 0));
  };

  const submitMemo = async (line: string) => {
    if (!cwd) { setMemoStatus("No cwd — memo not saved"); return; }
    try {
      await api.memoryAppend(cwd, line.replace(/^#\s*/, ""), "project");
      setMemoStatus("saved to CLAUDE.md");
    } catch {
      setMemoStatus("failed to save memo");
    } finally {
      setTimeout(() => setMemoStatus(null), 2500);
    }
  };

  const isRunning = status === "running";

  const submit = async () => {
    if (isRunning) return;
    const text = draft.trimEnd();
    if (!text && images.length === 0) return;

    if (text.startsWith("#") && images.length === 0 && !text.includes("\n")) {
      await submitMemo(text);
      setDraft("");
      return;
    }

    if (images.length > 0) {
      const blocks: ChatBlock[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const img of images) {
        blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
      }
      await onSend(blocks);
    } else {
      await onSend(text);
    }
    setDraft("");
    setImages([]);
    setTrigger(null);
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip Enter handling while IME composition is active (e.g. Chinese input)
    if (e.nativeEvent.isComposing || isComposing.current || e.keyCode === 229) {
      return;
    }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); onCycleMode(); return; }
    if (trigger && (trigger.kind === "/" || trigger.kind === "@") && items.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(items.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        if (trigger.kind === "/") pickSlash(filteredCmds[activeIdx]);
        else pickFile((fileMatches || [])[activeIdx]);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setTrigger(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl+Enter = newline
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      await submit();
    }
  };

  const addImages = async (files: FileList | File[]) => {
    const newOnes: ImagePayload[] = [];
    let running = totalBytes;
    for (const f of Array.from(files)) {
      const p = await fileToImagePayload(f);
      if (!p) continue;
      if (running + p.bytes > TOTAL_MAX) break;
      running += p.bytes;
      newOnes.push(p);
    }
    if (newOnes.length) setImages((xs) => [...xs, ...newOnes]);
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); await addImages(files); }
  };

  const onDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      await addImages(e.dataTransfer.files);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-white">
      <div className="max-w-[820px] mx-auto w-full">
      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.dataUrl}
                alt={img.name || "image"}
                className="h-14 w-14 object-cover rounded-lg border border-gray-200"
              />
              <button
                onClick={() => setImages((xs) => xs.filter((x) => x.id !== img.id))}
                className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center text-[11px] text-gray-500 opacity-0 group-hover:opacity-100 hover:bg-gray-100 transition-all shadow-sm"
                aria-label="remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pt-3 pb-2 relative">
        <textarea
          ref={taRef}
          value={draft}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={() => { isComposing.current = false; }}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          disabled={isRunning}
          placeholder={
            isRunning
              ? "Claude is working…"
              : "Message Claude  ·  / commands · @ files"
          }
          rows={3}
          className={
            "w-full bg-gray-50 border rounded-2xl px-4 py-3 text-[13.5px] resize-none outline-none font-sans leading-relaxed transition-all shadow-sm " +
            (isRunning
              ? "border-orange-200 bg-orange-50/20 text-gray-400 cursor-not-allowed"
              : "border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 focus:bg-white")
          }
        />
        {trigger?.kind === "/" && (
          <SlashCommandMenu items={filteredCmds} active={activeIdx} onPick={pickSlash} onHover={setActiveIdx} />
        )}
        {trigger?.kind === "@" && (
          <FileMentionMenu items={fileMatches || []} active={activeIdx} onPick={pickFile} onHover={setActiveIdx} />
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 pb-3">
        {/* Image upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addImages(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isRunning}
          title="Attach image"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
            <circle cx="5.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            <path d="M1.5 11l3.5-3.5 2.5 2.5 2-2 4 4" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>

        <ModeDropdown mode={mode} onChange={onSelectMode} />
        <EffortDropdown effort={effort} onChange={onSelectEffort} />
        <ModelDropdown model={model} onChange={onSelectModel} />

        <div className="flex-1" />

        {memoStatus && <span className="text-[11px] italic text-orange-500">{memoStatus}</span>}

        {isRunning && <WorkingIndicator />}

        {isRunning ? (
          <button
            onClick={onInterrupt}
            className="flex items-center gap-1.5 bg-white border border-red-200 text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg font-medium text-[12px] transition-colors"
          >
            <span className="inline-block w-2 h-2 bg-red-500 rounded-sm" />
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!draft.trim() && images.length === 0}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg font-medium text-[13px] inline-flex items-center gap-1.5 transition-colors"
          >
            Send →
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

export function nextMode(current: string): string {
  const MODE_CYCLE = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
  const idx = MODE_CYCLE.indexOf(current as any);
  if (idx < 0) return MODE_CYCLE[0];
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
}

const MODE_OPTIONS: { value: string; label: string; desc: string; cls: string }[] = [
  { value: "default", label: "Default", desc: "Ask before each tool", cls: "border-gray-200 text-gray-600" },
  { value: "acceptEdits", label: "Accept edits", desc: "Auto-allow file edits", cls: "border-orange-300 text-orange-600 bg-orange-50" },
  { value: "plan", label: "Plan", desc: "Read-only; produce a plan", cls: "border-amber-300 text-amber-700 bg-amber-50" },
  { value: "bypassPermissions", label: "Bypass", desc: "Never ask (dangerous)", cls: "border-red-300 text-red-500 bg-red-50" },
];

function ModeDropdown({ mode, onChange }: { mode: string; onChange?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = MODE_OPTIONS.find((o) => o.value === mode) || MODE_OPTIONS[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Permission mode (Shift+Tab to cycle)"
        className={"px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors inline-flex items-center gap-1 hover:bg-gray-50 " + cur.cls}
      >
        <span>{cur.label}</span>
        <span className="text-[9px] text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 left-0 z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Permission mode</div>
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => { setOpen(false); onChange?.(o.value); }}
                className={"w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors " + (o.value === mode ? "bg-orange-50/60" : "")}
              >
                <div className={"text-[12px] font-medium " + (o.value === mode ? "text-orange-700" : "text-gray-800")}>{o.label}</div>
                <div className="text-[10.5px] text-gray-400 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const EFFORT_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "", label: "Default", desc: "Standard thinking" },
  { value: "low", label: "Low", desc: "Faster, less thinking" },
  { value: "medium", label: "Medium", desc: "Balanced" },
  { value: "high", label: "High", desc: "More thorough" },
  { value: "xhigh", label: "X-High", desc: "Extended thinking" },
  { value: "max", label: "Max", desc: "Maximum reasoning" },
];

function EffortDropdown({ effort, onChange }: { effort?: string; onChange?: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = EFFORT_OPTIONS.find((o) => o.value === (effort || "")) || EFFORT_OPTIONS[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Thinking effort"
        className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-[11px] font-medium transition-colors inline-flex items-center gap-1"
      >
        <span>⎈ {cur.label}</span>
        <span className="text-[9px] text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 left-0 z-50 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Thinking effort</div>
            {EFFORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => { setOpen(false); onChange?.(o.value); }}
                className={"w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors " + (o.value === (effort || "") ? "bg-orange-50/60" : "")}
              >
                <div className={"text-[12px] font-medium " + (o.value === (effort || "") ? "text-orange-700" : "text-gray-800")}>{o.label}</div>
                <div className="text-[10.5px] text-gray-400 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MODEL_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "", label: "Default", desc: "SDK default (Opus 4.7)" },
  { value: "claude-opus-4-7", label: "Opus 4.7", desc: "Most capable" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6", desc: "Balanced" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5", desc: "Fastest" },
];

function ModelDropdown({ model, onChange }: { model?: string; onChange?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = MODEL_OPTIONS.find((o) => o.value === (model || "")) || MODEL_OPTIONS[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Model"
        className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-[11px] font-medium transition-colors inline-flex items-center gap-1"
      >
        <span>◆ {cur.label}</span>
        <span className="text-[9px] text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 left-0 z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Model</div>
            {MODEL_OPTIONS.map((o) => (
              <button
                key={o.value || "default"}
                onClick={() => { setOpen(false); onChange?.(o.value); }}
                className={"w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors " + (o.value === (model || "") ? "bg-orange-50/60" : "")}
              >
                <div className={"text-[12px] font-medium " + (o.value === (model || "") ? "text-orange-700" : "text-gray-800")}>{o.label}</div>
                <div className="text-[10.5px] text-gray-400 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Playful spinner verbs lifted from the Claude Code CLI binary. Each verb is
// paired with a loose Chinese gloss so users can sense what Claude is "doing".
const WORKING_VERBS: Array<[string, string]> = [
  ["Architecting", "构建中"],
  ["Brewing", "酝酿中"],
  ["Channeling", "通灵中"],
  ["Choreographing", "编排中"],
  ["Cogitating", "思索中"],
  ["Combobulating", "整理中"],
  ["Concocting", "调制中"],
  ["Crystallizing", "凝结中"],
  ["Decompressing", "解压中"],
  ["Germinating", "萌芽中"],
  ["Honking", "鸣笛中"],
  ["Hullaballooing", "喧闹中"],
  ["Incubating", "孵化中"],
  ["Lollygagging", "晃悠中"],
  ["Manifesting", "显化中"],
  ["Marinating", "腌制中"],
  ["Meandering", "漫游中"],
  ["Musing", "沉思中"],
  ["Noodling", "捣鼓中"],
  ["Orchestrating", "统筹中"],
  ["Percolating", "渗透中"],
  ["Photosynthesizing", "光合中"],
  ["Pondering", "斟酌中"],
  ["Reticulating", "织网中"],
  ["Ruminating", "反刍中"],
  ["Schlepping", "搬运中"],
  ["Simmering", "炖煮中"],
  ["Smooshing", "揉捏中"],
  ["Sprouting", "发芽中"],
  ["Synthesizing", "合成中"],
  ["Transmuting", "蜕变中"],
  ["Vibing", "找感觉"],
  ["Whirring", "嗡嗡中"],
  ["Wrangling", "驯服中"],
];

function WorkingIndicator() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * WORKING_VERBS.length));
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    const tickElapsed = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    const tickVerb = setInterval(() => {
      setIdx(Math.floor(Math.random() * WORKING_VERBS.length));
    }, 3500);
    return () => { clearInterval(tickElapsed); clearInterval(tickVerb); };
  }, []);

  const [verb, zh] = WORKING_VERBS[idx];

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-orange-500">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 animate-ping opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
      </span>
      <span>{verb}…</span>
      <span className="text-[11px] text-orange-400/80">{zh}</span>
      <span className="font-mono text-[11px] text-orange-400 tabular-nums">({elapsed}s)</span>
    </span>
  );
}

const Composer = forwardRef<ComposerHandle, Props>(ComposerImpl);
export default Composer;
