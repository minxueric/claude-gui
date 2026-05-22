import { useState } from "react";

export default function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="my-1 text-[12.5px]">
      <button
        onClick={() => setOpen(!open)}
        className="display-italic text-muted hover:text-clay transition-colors text-[13px]"
      >
        {open ? "▾" : "▸"} thinking · {text.length} chars
      </button>
      {open && (
        <div className="mt-2 pl-4 border-l-2 border-rule2 text-ink2 italic whitespace-pre-wrap leading-relaxed text-[13px]">
          {text}
        </div>
      )}
    </div>
  );
}
