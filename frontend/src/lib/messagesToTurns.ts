// Convert JSONL-derived MessageRow records into ChatTurn objects compatible
// with useChatStream / AssistantTurnGroup, so resumed sessions look identical
// to live ones.
import { MessageRow } from "../lib/api";
import { ChatTurn, ChatBlock } from "../hooks/useChatStream";

// CLI injects synthetic user messages wrapped in tags like
// <local-command-stdout>, <local-command-caveat>, <command-name>,
// <command-message>, <command-args>, <system-reminder>, <persisted-output>.
// These are meta plumbing, not real user content — hide them on replay.
function isMetaMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /^<(local-command-|command-(name|message|args|stdout)|system-reminder|persisted-output)/.test(t);
}

function blockFromRaw(b: any): ChatBlock | null {
  if (!b || typeof b !== "object") return null;
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text || "" };
    case "thinking":
      return { type: "thinking", thinking: b.thinking || "" };
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: b.tool_use_id,
        content: b.content,
        is_error: b.is_error,
      };
    case "image":
      return { type: "image", source: b.source };
    default:
      return null;
  }
}

export function messagesToTurns(rows: MessageRow[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const row of rows) {
    if (row.role === "file-history-snapshot") continue;
    const raw = row.raw;
    const msg = raw?.message;
    const content = msg?.content;
    let blocks: ChatBlock[] = [];
    if (typeof content === "string") {
      if (isMetaMessage(content)) continue;
      blocks = [{ type: "text", text: content }];
    } else if (Array.isArray(content)) {
      blocks = content
        .map(blockFromRaw)
        .filter((b): b is ChatBlock => {
          if (b === null) return false;
          // Drop user text blocks that are entirely meta plumbing
          if (b.type === "text" && isMetaMessage(b.text || "")) return false;
          return true;
        });
    }
    if (blocks.length === 0) continue;
    // Filter user messages that are entirely tool results — they're paired into assistant turns
    if (row.role === "user" && blocks.every((b) => b.type === "tool_result")) {
      // Attach these tool_results to the previous assistant turn so AssistantTurnGroup can pair them by id
      const lastAssistant = [...out].reverse().find((t) => t.role === "assistant");
      if (lastAssistant) {
        lastAssistant.blocks = [...lastAssistant.blocks, ...blocks];
      }
      continue;
    }
    out.push({
      role: row.role === "user" ? "user" : "assistant",
      model: row.model || undefined,
      blocks,
      ts: (row.ts || 0),
    });
  }
  return out;
}
