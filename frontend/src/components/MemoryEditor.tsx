import { useEffect, useRef, useState } from "react";
import { api, MemoryDoc } from "../lib/api";
import clsx from "clsx";

interface Props {
  doc: MemoryDoc;
  cwd: string;
  onSaved: () => void;
}

export default function MemoryEditor({ doc, cwd, onSaved }: Props) {
  const [text, setText] = useState(doc.text);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Reset when doc identity changes (path or scope).
  useEffect(() => {
    setText(doc.text);
    setDirty(false);
    setStatus("idle");
    setError(null);
  }, [doc.path, doc.scope]);

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      await api.memorySave(cwd || doc.path, doc.scope, text);
      setDirty(false);
      setStatus("saved");
      onSaved();
      setTimeout(() => setStatus("idle"), 1500);
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "save failed");
    }
  }

  const label = doc.scope === "project" ? "Project memory" : "User memory";
  const sub = doc.scope === "project" ? "<cwd>/CLAUDE.md" : "~/.claude/CLAUDE.md";

  return (
    <div className="flex flex-col h-full border border-rule bg-paper">
      <div className="px-4 py-3 border-b border-rule flex items-baseline gap-3">
        <div>
          <div className="eyebrow">{label}</div>
          <div className="font-mono text-[10.5px] text-muted truncate max-w-[420px]" title={doc.path}>
            {sub}
          </div>
        </div>
        <span className="flex-1" />
        {!doc.exists && (
          <span className="font-mono text-[10px] text-muted px-2 py-0.5 border border-rule rounded-sm">
            new file
          </span>
        )}
        <span className="font-mono text-[10px] text-muted tabular-nums">
          {new Blob([text]).size.toLocaleString()} bytes
        </span>
        <button
          onClick={save}
          disabled={!dirty || status === "saving"}
          className={clsx(
            "px-3 py-1 rounded-sm border text-[12px] transition-colors",
            dirty
              ? "border-clay text-clayDeep hover:bg-clayWash"
              : "border-rule text-muted cursor-default"
          )}
        >
          {status === "saving" ? "saving…" : status === "saved" ? "saved" : "Save"}
        </button>
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        spellCheck={false}
        className="flex-1 resize-none px-4 py-3 bg-canvas font-mono text-[12.5px] leading-relaxed text-ink outline-none"
        placeholder={
          doc.scope === "project"
            ? "Per-project guidance — pinned style, conventions, owners, todos…"
            : "Global guidance applied to every project."
        }
      />
      {error && <div className="px-4 py-2 border-t border-rule text-[11px] text-clayDeep">{error}</div>}
    </div>
  );
}
