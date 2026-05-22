import { useState } from "react";

export default function ToolResultCard({ content, isError }: { content: any; isError?: boolean }) {
  const [open, setOpen] = useState(false);
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : JSON.stringify(b)))
      .join("\n");
  } else {
    try { text = JSON.stringify(content, null, 2); } catch { text = String(content); }
  }
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";
  const preview = firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine;
  const lineCount = text ? text.split("\n").length : 0;
  return (
    <div className="my-1 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-center gap-2 py-0.5 px-1 hover:bg-gray-50 rounded-md transition-colors"
      >
        <span className={"shrink-0 font-mono text-[10.5px] " + (isError ? "text-red-400" : "text-amber-500")}>
          ↳ {isError ? "error" : "result"}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-gray-500">{preview}</span>
        <span className="font-mono text-[10px] text-gray-400 shrink-0">{lineCount} ln · {text.length}c</span>
        <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className={"mt-1 px-3 py-2 rounded-lg border text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed " + (isError ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-700")}>
{text}
        </pre>
      )}
    </div>
  );
}
