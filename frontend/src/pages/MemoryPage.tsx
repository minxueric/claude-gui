import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import MemoryEditor from "../components/MemoryEditor";

export default function MemoryPage() {
  const recent = useQuery({ queryKey: ["recent-sessions-for-memory"], queryFn: () => api.recentSessions(10) });
  const [cwd, setCwd] = useState<string>("");

  useEffect(() => {
    if (!cwd && recent.data?.length) {
      const p = recent.data.find((s) => s.projectPath)?.projectPath || "";
      if (p) setCwd(p);
    }
  }, [recent.data, cwd]);

  const memory = useQuery({
    queryKey: ["memory", cwd],
    queryFn: () => api.memory(cwd || undefined),
    enabled: true,
  });

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white">
      <header className="px-8 pt-6 pb-5 border-b border-gray-100">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[20px] font-semibold text-gray-900">Memory · CLAUDE.md</h1>
          <div className="flex items-center gap-2">
            <label className="font-mono text-[11px] text-gray-400">cwd</label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/absolute/path/to/project"
              className="px-3 py-1.5 border border-gray-200 rounded-lg font-mono text-[11.5px] bg-gray-50 text-gray-800 min-w-[320px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
            />
          </div>
        </div>
      </header>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-5 p-8 overflow-y-auto">
        {memory.data?.project ? (
          <MemoryEditor doc={memory.data.project} cwd={cwd} onSaved={() => memory.refetch()} />
        ) : (
          <div className="border border-dashed border-gray-200 rounded-xl px-6 py-10 flex flex-col items-center justify-center text-center">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Project memory</div>
            <div className="text-gray-400 text-[14px] italic">
              {cwd ? "Cannot read project CLAUDE.md for this cwd." : "Set a cwd above to load project memory."}
            </div>
          </div>
        )}
        {memory.data?.user && (
          <MemoryEditor doc={memory.data.user} cwd={cwd} onSaved={() => memory.refetch()} />
        )}
      </div>
    </div>
  );
}
