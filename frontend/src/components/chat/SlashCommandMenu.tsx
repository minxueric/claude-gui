import { SlashCommand } from "../../lib/api";

interface Props {
  items: SlashCommand[];
  active: number;
  onPick: (c: SlashCommand) => void;
  onHover: (i: number) => void;
}

const SCOPE_COLORS: Record<string, string> = {
  builtin: "bg-blue-50 text-blue-500",
  user: "bg-purple-50 text-purple-500",
  project: "bg-green-50 text-green-600",
};

export default function SlashCommandMenu({ items, active, onPick, onHover }: Props) {
  if (items.length === 0) {
    return (
      <div className="absolute bottom-full mb-2 left-0 w-[480px] bg-white border border-gray-200 rounded-xl shadow-md px-4 py-3 text-[12px] text-gray-400">
        No matching commands
      </div>
    );
  }
  return (
    <div className="absolute bottom-full mb-2 left-0 w-[540px] max-h-[360px] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-md py-1.5">
      <div className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        Slash commands
      </div>
      {items.map((c, i) => (
        <button
          key={`${c.scope}:${c.name}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(c)}
          className={
            "w-full text-left px-3 py-2 mx-1.5 flex items-center gap-2.5 rounded-lg transition-colors " +
            (i === active ? "bg-orange-50" : "hover:bg-gray-50")
          }
          style={{ width: "calc(100% - 12px)" }}
        >
          <span className={
            "font-mono text-[13px] font-medium shrink-0 " +
            (i === active ? "text-orange-600" : "text-gray-800")
          }>
            /{c.name}
          </span>
          {c.argumentHint && (
            <span className="font-mono text-[11px] text-gray-400 shrink-0">{c.argumentHint}</span>
          )}
          <span className="text-[12px] text-gray-500 truncate flex-1 min-w-0">{c.description}</span>
          <span className={
            "text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 " +
            (SCOPE_COLORS[c.scope] || "bg-gray-100 text-gray-500")
          }>
            {c.scope}
          </span>
        </button>
      ))}
    </div>
  );
}
