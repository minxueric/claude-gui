import { MessageRow } from "../lib/api";
import MarkdownBlock from "./blocks/MarkdownBlock";
import ThinkingBlock from "./blocks/ThinkingBlock";
import ToolUseCard from "./blocks/ToolUseCard";
import ToolResultCard from "./blocks/ToolResultCard";
import EditDiffBlock from "./blocks/EditDiffBlock";
import { formatTime } from "../lib/api";

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export default function MessageRowView({ row }: { row: MessageRow }) {
  const raw = row.raw;
  const msg = raw?.message;
  const isSnapshot = row.role === "file-history-snapshot";
  const cwd = row.cwd || undefined;

  if (isSnapshot) {
    return (
      <div className="px-6 py-2 flex items-center gap-3 text-[10.5px] text-muted">
        <span className="h-px flex-1 dot-divider" />
        <span className="font-mono">file snapshot · {formatTime(row.ts)}</span>
        <span className="h-px flex-1 dot-divider" />
      </div>
    );
  }

  const content = msg?.content;
  const blocks: JSX.Element[] = [];

  if (typeof content === "string") {
    blocks.push(<MarkdownBlock key="t" text={content} />);
  } else if (Array.isArray(content)) {
    content.forEach((b: any, i: number) => {
      if (!b || typeof b !== "object") return;
      switch (b.type) {
        case "text":
          blocks.push(<MarkdownBlock key={i} text={b.text || ""} />);
          break;
        case "thinking":
          blocks.push(<ThinkingBlock key={i} text={b.thinking || ""} />);
          break;
        case "tool_use":
          if (b.name && DIFF_TOOLS.has(b.name)) {
            blocks.push(<EditDiffBlock key={i} name={b.name} input={b.input} cwd={cwd} />);
          } else {
            blocks.push(<ToolUseCard key={i} name={b.name} input={b.input} />);
          }
          break;
        case "tool_result":
          blocks.push(<ToolResultCard key={i} content={b.content} isError={b.is_error} />);
          break;
        default:
          blocks.push(
            <pre key={i} className="text-[11px] text-muted">{`[${b.type}]`}</pre>
          );
      }
    });
  }

  if (row.role === "user") {
    return (
      <article className="px-6 py-4 flex justify-end gap-3">
        <div className="max-w-[72%] flex flex-col items-end">
          <div className="text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">You</div>
          <div className="user-bubble bg-orange-500 px-4 py-2 rounded-2xl rounded-tr-sm text-[13.5px] font-medium leading-relaxed text-white whitespace-pre-wrap break-words">
            {blocks}
          </div>
          <div className="font-mono text-[10px] text-gray-400 mt-1">{formatTime(row.ts)}</div>
        </div>
        <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0 mt-7 text-[12px] font-semibold text-orange-600 select-none">
          U
        </div>
      </article>
    );
  }

  // assistant / tool_result / system / result rows
  const isToolResult = row.role === "tool_result";
  return (
    <article className="px-6 py-4 flex gap-3">
      <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2L13 5.5V10.5L8 14L3 10.5V5.5L8 2Z" fill="white" fillOpacity="0.95"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-2 mb-2">
          <span className="text-[13px] font-semibold text-gray-900">Claude</span>
          {row.model && <span className="font-mono text-[11px] text-gray-400">· {row.model}</span>}
          {isToolResult && row.toolName && (
            <span className="font-mono text-[11px] text-orange-500">· ⚙ {row.toolName}</span>
          )}
          <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-gray-400">
            {row.tokensIn != null && <span>↓{row.tokensIn} ↑{row.tokensOut}</span>}
            <span>{formatTime(row.ts)}</span>
          </div>
        </header>
        <div className="border-l-2 border-gray-100 pl-4 space-y-2">{blocks}</div>
      </div>
    </article>
  );
}
