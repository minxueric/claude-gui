import { useState } from "react";

export default function ToolUseCard({ name, input }: { name: string; input: any }) {
  const [open, setOpen] = useState(false);
  const inputStr = (() => {
    try { return JSON.stringify(input, null, 2); } catch { return String(input); }
  })();
  const preview = (() => {
    if (input && typeof input === "object") {
      if (typeof input.command === "string") return input.command;
      if (typeof input.file_path === "string") return input.file_path;
      if (typeof input.pattern === "string") return input.pattern;
      if (typeof input.prompt === "string") return input.prompt.slice(0, 120);
    }
    return inputStr.length > 160 ? inputStr.slice(0, 160) + "…" : inputStr;
  })();
  return (
    <div className="my-1 rounded-lg overflow-hidden">
      <button
        className="w-full text-left flex items-center gap-2 py-0.5 px-1 hover:bg-gray-50 rounded-md transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-orange-500 font-mono text-[11px] shrink-0">⚙ {name}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-gray-500">{preview}</span>
        <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className="mt-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
{inputStr}
        </pre>
      )}
    </div>
  );
}
