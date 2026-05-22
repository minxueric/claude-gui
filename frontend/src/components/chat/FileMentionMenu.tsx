import { FileMatch } from "../../lib/api";

interface Props {
  items: FileMatch[];
  active: number;
  onPick: (m: FileMatch) => void;
  onHover: (i: number) => void;
}

export default function FileMentionMenu({ items, active, onPick, onHover }: Props) {
  if (items.length === 0) {
    return (
      <div className="absolute bottom-full mb-2 left-0 w-[480px] bg-white border border-gray-200 rounded-xl shadow-md px-4 py-3 text-[12px] text-gray-400">
        No matching files
      </div>
    );
  }
  return (
    <div className="absolute bottom-full mb-2 left-0 w-[540px] max-h-[360px] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-md py-1.5">
      <div className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        Files
      </div>
      {items.map((m, i) => (
        <button
          key={m.path}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(m)}
          className={
            "w-full text-left px-3 py-2 mx-1.5 flex items-center gap-2.5 rounded-lg transition-colors " +
            (i === active ? "bg-orange-50" : "hover:bg-gray-50")
          }
          style={{ width: "calc(100% - 12px)" }}
        >
          <span className="shrink-0 text-[14px]">{m.isDir ? "📁" : "📄"}</span>
          <span className={
            "text-[13px] font-medium shrink-0 " +
            (i === active ? "text-orange-600" : "text-gray-800")
          }>
            {m.name}
          </span>
          {m.isDir && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 shrink-0">dir</span>
          )}
          <span className="font-mono text-[11px] text-gray-400 truncate flex-1 min-w-0 text-right">{m.path}</span>
        </button>
      ))}
    </div>
  );
}
