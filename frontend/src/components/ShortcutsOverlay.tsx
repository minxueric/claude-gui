import { useState } from "react";
import { useShortcuts } from "../hooks/useShortcuts";

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "⌘/Ctrl + K", desc: "Open command palette" },
  { keys: "?", desc: "Show this shortcuts overlay" },
  { keys: "Esc", desc: "Close any open overlay / menu" },
  { keys: "Shift + Tab", desc: "Cycle permission mode (in chat composer)" },
  { keys: "⌘/Ctrl + Enter", desc: "Send message (in chat composer)" },
  { keys: "/", desc: "Slash command menu (line-start)" },
  { keys: "@", desc: "Mention a file from cwd" },
  { keys: "!", desc: "Send a Bash request to Claude" },
  { keys: "#", desc: "Append line to CLAUDE.md (memo)" },
];

export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  useShortcuts(
    [
      { combo: "?", handler: () => setOpen((o) => !o) },
      { combo: "esc", handler: () => (open ? (setOpen(false), true) : false) },
    ],
    [open]
  );
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] flex items-center justify-center animate-fade"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] bg-paper border border-rule shadow-lift rounded-sm p-6 animate-rise"
      >
        <div className="eyebrow mb-2">Reference</div>
        <h2 className="display text-[26px] mb-4">
          Keyboard <span className="display-italic text-clay">shortcuts</span>
        </h2>
        <table className="w-full text-[13px]">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-rule last:border-0">
                <td className="py-2 pr-4 font-mono text-ink2 whitespace-nowrap">{s.keys}</td>
                <td className="py-2 text-ink">{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-right">
          <button
            onClick={() => setOpen(false)}
            className="text-[12px] eyebrow text-muted hover:text-ink"
          >
            close ✕
          </button>
        </div>
      </div>
    </div>
  );
}
