import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import { useMemo } from "react";
import { api, formatTime, sessionTitle, MessageRow } from "../lib/api";
import MessageRowView from "../components/MessageRow";
import HistoryAssistantGroup from "../components/HistoryAssistantGroup";

type Group =
  | { kind: "single"; row: MessageRow }
  | { kind: "assistant_group"; rows: MessageRow[] };

function groupMessages(messages: MessageRow[]): Group[] {
  const out: Group[] = [];
  let buf: MessageRow[] = [];
  const flush = () => {
    if (buf.length > 0) {
      out.push({ kind: "assistant_group", rows: buf });
      buf = [];
    }
  };
  for (const m of messages) {
    // user / snapshot stays as its own block; everything else (assistant /
    // tool_result / system / result) merges into the surrounding Claude group.
    if (m.role === "user" || m.role === "file-history-snapshot") {
      flush();
      out.push({ kind: "single", row: m });
    } else {
      buf.push(m);
    }
  }
  flush();
  return out;
}

export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.session(sessionId),
    enabled: !!sessionId,
  });

  const groups = useMemo(() => (data ? groupMessages(data.messages) : []), [data]);

  if (isLoading) return <div className="p-12 text-gray-400">Loading…</div>;
  if (error) return <div className="p-12 text-red-500">Error: {(error as Error).message}</div>;
  if (!data) return null;
  const { session, messages } = data;
  const cwd = session.projectPath || undefined;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 pt-6 pb-5 border-b border-gray-100 bg-white">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Link
              to="/chat"
              className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
            >
              ← {session.projectPath?.split("/").pop() || "project"}
            </Link>
            <h1 className="text-[20px] font-semibold text-gray-900 leading-tight mt-2">
              {sessionTitle(session)}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-gray-400">
              <span title={session.sessionId}>{session.sessionId.slice(0, 8)}</span>
              {session.gitBranch && <span><span className="text-orange-500">⎇</span> {session.gitBranch}</span>}
              <span>{messages.length} messages</span>
              <span>{formatTime(session.modified)}</span>
            </div>
          </div>
          <Link
            to={`/chat?resume=${session.sessionId}&cwd=${encodeURIComponent(session.projectPath || "")}`}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors"
          >
            Continue →
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <Virtuoso
          data={groups}
          itemContent={(_, g) =>
            g.kind === "single" ? (
              <MessageRowView row={g.row} />
            ) : (
              <HistoryAssistantGroup rows={g.rows} cwd={cwd} />
            )
          }
          increaseViewportBy={400}
          style={{ height: "100%" }}
          className="bg-white"
        />
      </div>
    </div>
  );
}
