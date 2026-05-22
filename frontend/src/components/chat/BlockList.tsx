import { ChatBlock } from "../../hooks/useChatStream";
import MarkdownBlock from "../blocks/MarkdownBlock";
import ThinkingBlock from "../blocks/ThinkingBlock";
import ToolUseCard from "../blocks/ToolUseCard";
import ToolResultCard from "../blocks/ToolResultCard";
import EditDiffBlock from "../blocks/EditDiffBlock";

interface Props {
  blocks: ChatBlock[];
  cwd?: string;
}

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export default function BlockList({ blocks, cwd }: Props) {
  return (
    <div className="space-y-1">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return <MarkdownBlock key={i} text={b.text || ""} />;
          case "thinking":
            return <ThinkingBlock key={i} text={b.thinking || ""} />;
          case "tool_use":
            if (b.name && DIFF_TOOLS.has(b.name)) {
              return <EditDiffBlock key={i} name={b.name} input={b.input} cwd={cwd} />;
            }
            return <ToolUseCard key={i} name={b.name || ""} input={b.input} />;
          case "tool_result":
            return <ToolResultCard key={i} content={b.content} isError={b.is_error} />;
          default:
            return <pre key={i} className="text-xs text-muted">[{b.type}]</pre>;
        }
      })}
    </div>
  );
}
