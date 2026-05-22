import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatTime } from "../lib/api";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [role, setRole] = useState("");
  const [tool, setTool] = useState("");
  const [submit, setSubmit] = useState({ q: "", project: "", role: "", tool: "" });

  const { data: facets } = useQuery({ queryKey: ["facets", project], queryFn: () => api.facets(project || undefined) });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  const { data, isFetching } = useQuery({
    queryKey: ["search", submit],
    queryFn: () => api.search({ q: submit.q, project: submit.project || undefined, role: submit.role || undefined, tool: submit.tool || undefined, limit: 100 }),
    enabled: !!submit.q,
  });

  return (
    <div className="h-full flex flex-col bg-white">
      <header className="px-8 pt-6 pb-5 border-b border-gray-100">
        <h1 className="text-[20px] font-semibold text-gray-900 mb-4">Search</h1>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setSubmit({ q, project, role, tool }); }}>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search messages, tool inputs, results…"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg pl-4 pr-3 py-2 text-[13.5px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
              autoFocus
            />
            <button className="bg-orange-500 hover:bg-orange-600 text-white font-medium px-5 rounded-lg text-[13px] transition-colors">
              Search
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect value={project} onChange={setProject} label="Project">
              <option value="">All projects</option>
              {projects?.map((p) => (
                <option key={p.encoded} value={p.encoded}>{p.cwd.split("/").filter(Boolean).pop()}</option>
              ))}
            </FilterSelect>
            <FilterSelect value={role} onChange={setRole} label="Role">
              <option value="">All roles</option>
              {facets?.roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </FilterSelect>
            <FilterSelect value={tool} onChange={setTool} label="Tool">
              <option value="">All tools</option>
              {facets?.tools.map((t) => <option key={t} value={t}>{t}</option>)}
            </FilterSelect>
          </div>
        </form>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!submit.q && (
          <div className="text-gray-400 text-[14px] italic">Type a query above to begin.</div>
        )}
        {isFetching && <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Searching…</div>}
        {data && (
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-4">
            {data.total} {data.total === 1 ? "result" : "results"}
          </div>
        )}
        <div className="space-y-1">
          {data?.hits.map((h, i) => (
            <Link
              key={h.uuid}
              to={`/sessions/${h.sessionId}#${h.uuid}`}
              style={{ animationDelay: `${Math.min(i, 10) * 20}ms` }}
              className="group block bg-white border border-gray-100 rounded-lg px-4 py-3 hover:border-gray-300 hover:shadow-sm transition-all animate-rise"
            >
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-[12px] font-semibold text-orange-500">{roleLabel(h.role)}</span>
                {h.toolName && <span className="font-mono text-[10.5px] text-orange-400">⚙ {h.toolName}</span>}
                <span className="ml-auto font-mono text-[10px] text-gray-400">{formatTime(h.ts)}</span>
              </div>
              <div className="text-[13.5px] leading-relaxed text-gray-700" dangerouslySetInnerHTML={{ __html: h.snippet }} />
              <div className="mt-1.5 font-mono text-[10.5px] text-gray-400 truncate">
                {h.sessionFirstPrompt || h.sessionId.slice(0, 8)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center bg-gray-50 border border-gray-200 rounded-lg overflow-hidden focus-within:border-orange-400 text-[12px]">
      <span className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-r border-gray-200">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent px-3 py-1.5 outline-none text-[12.5px] text-gray-700">
        {children}
      </select>
    </label>
  );
}

function roleLabel(r: string): string {
  if (r === "user") return "You";
  if (r === "assistant") return "Claude";
  return r;
}
