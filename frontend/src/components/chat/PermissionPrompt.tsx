import { useState } from "react";
import { PermissionRequest } from "../../hooks/useChatStream";
import EditDiffBlock from "../blocks/EditDiffBlock";

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

interface Props {
  req: PermissionRequest;
  onDecide: (d: "allow" | "deny" | "allow_once", message?: string) => void;
  cwd?: string;
}

export default function PermissionPrompt({ req, onDecide, cwd }: Props) {
  const isDiff = DIFF_TOOLS.has(req.toolName);
  const [showInput, setShowInput] = useState(isDiff);  // auto-expand diff by default
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  const inputStr = (() => {
    try { return JSON.stringify(req.input, null, 2); } catch { return String(req.input); }
  })();
  const preview = (() => {
    const i = req.input;
    if (i && typeof i === "object") {
      if (typeof i.command === "string") return i.command;
      if (typeof i.file_path === "string") return i.file_path;
      if (typeof i.pattern === "string") return i.pattern;
      if (typeof i.prompt === "string") return i.prompt.slice(0, 120);
      if (typeof i.path === "string") return i.path;
    }
    return inputStr.length > 160 ? inputStr.slice(0, 160) + "…" : inputStr;
  })();

  return (
    <li>
      <div className="mt-1 mb-1 rounded-lg border border-orange-300 bg-orange-50/60 overflow-hidden">
        {/* Header row — same shape as a tool_use line */}
        <div className="flex items-center gap-2 px-2 py-1.5 bg-orange-50">
          <span className="text-[10px] font-semibold text-orange-600 uppercase tracking-wider shrink-0">
            Permission required
          </span>
          <span className="text-orange-500 font-mono text-[11px] shrink-0">⚙ {req.toolName}</span>
          <span className="flex-1 truncate font-mono text-[11px] text-gray-600">{preview}</span>
          <button
            onClick={() => setShowInput((v) => !v)}
            className="text-gray-400 hover:text-gray-600 text-[10px] shrink-0"
            title={showInput ? "Hide input" : "Show input"}
          >
            {showInput ? "▾" : "▸"}
          </button>
        </div>

        {showInput && (
          isDiff ? (
            <div className="mx-2 mt-1 mb-2">
              <EditDiffBlock name={req.toolName} input={req.input} cwd={cwd} />
            </div>
          ) : (
            <pre className="mx-2 mt-1 mb-2 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-gray-700 text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed max-h-60">
{inputStr}
            </pre>
          )
        )}

        {showFeedback ? (
          <div className="px-2 pb-2 flex gap-2">
            <input
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") onDecide("deny", feedback.trim() || undefined);
                if (e.key === "Escape") { setShowFeedback(false); setFeedback(""); }
              }}
              placeholder="Tell Claude what to do differently (optional)…"
              className="flex-1 bg-white border border-gray-200 rounded-md px-2.5 py-1.5 text-[12px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <button
              onClick={() => { setShowFeedback(false); setFeedback(""); }}
              className="px-2.5 py-1.5 rounded-md text-[12px] text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => onDecide("deny", feedback.trim() || undefined)}
              className="px-3 py-1.5 rounded-md bg-red-500 hover:bg-red-600 text-white font-medium text-[12px]"
            >
              Send
            </button>
          </div>
        ) : (
          <div className="px-2 pb-2 flex flex-wrap items-center justify-end gap-1.5">
            <button
              onClick={() => setShowFeedback(true)}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-red-500 hover:bg-red-50 text-[12px] font-medium transition-colors"
            >
              No, tell Claude…
            </button>
            <button
              onClick={() => onDecide("allow_once")}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 text-[12px] font-medium transition-colors"
            >
              Allow once
            </button>
            <button
              onClick={() => onDecide("allow")}
              className="px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[12px] font-medium transition-colors inline-flex items-center gap-1"
            >
              Yes, allow for session →
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
