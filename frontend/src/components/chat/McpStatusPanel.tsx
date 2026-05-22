import { useState } from "react";
import { useMcpChatStatus, useMcpServers } from "../../hooks/useMcpStatus";

interface Props {
  chatId: string | null;
}

export default function McpStatusPanel({ chatId }: Props) {
  const [open, setOpen] = useState(false);
  const { data: servers } = useMcpServers();
  const { data: live } = useMcpChatStatus(chatId);

  const configuredCount = servers?.servers.length ?? 0;
  const liveAvailable = !!live?.available;

  // Hide entirely when no MCP servers are configured — it's just clutter otherwise.
  if (configuredCount === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="MCP servers"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600 transition-colors text-[11px] font-medium"
      >
        <span
          className={
            "inline-block w-1.5 h-1.5 rounded-full " +
            (liveAvailable ? "bg-green-500" : "bg-amber-400")
          }
        />
        <span>MCP · {configuredCount}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[320px] bg-white border border-gray-200 shadow-lg rounded-xl p-4 z-30">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">MCP servers</div>
          {servers?.servers.map((s) => (
            <div key={s.name} className="py-1.5 border-b border-gray-100 last:border-0">
              <div className="text-[13px] text-gray-900 font-medium">{s.name}</div>
              <div className="font-mono text-[10.5px] text-gray-500 truncate">
                {s.transport}
                {s.command ? ` · ${s.command}` : ""}
                {s.url ? ` · ${s.url}` : ""}
              </div>
            </div>
          ))}
          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <span>live session</span>
            <span className="font-mono text-[10.5px] text-gray-500 normal-case">
              {liveAvailable ? "available" : "not reported"}
            </span>
          </div>
          {liveAvailable && (
            <pre className="mt-2 bg-gray-50 border border-gray-200 rounded-md p-2 text-[10.5px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto text-gray-700">
              {JSON.stringify(live?.status, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
