import { useQuery } from "@tanstack/react-query";
import { api, formatTime, TodoItem } from "../lib/api";
import clsx from "clsx";

const STATUSES = ["pending", "in_progress", "completed"] as const;
const STATUS_META: Record<string, { label: string; dot: string; sym: string }> = {
  pending:     { label: "Pending",     dot: "bg-gray-300",   sym: "○" },
  in_progress: { label: "In progress", dot: "bg-amber-400",  sym: "◐" },
  completed:   { label: "Completed",   dot: "bg-green-500",  sym: "●" },
};

export default function TodosPage() {
  const { data, isLoading } = useQuery({ queryKey: ["todos"], queryFn: api.todos });
  if (isLoading) return <div className="p-8 text-gray-400 text-[13px]">Loading…</div>;

  const groups: Record<string, TodoItem[]> = { pending: [], in_progress: [], completed: [] };
  data?.forEach((f) =>
    f.todos.forEach((t) => {
      const s = t.status && groups[t.status] ? t.status : "pending";
      groups[s].push(t);
    })
  );

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="px-8 pt-6 pb-5 border-b border-gray-100">
        <h1 className="text-[20px] font-semibold text-gray-900">Todos</h1>
        <p className="text-[12px] text-gray-400 mt-1">{data?.length} files indexed</p>
      </header>

      <div className="px-8 py-6 grid grid-cols-1 md:grid-cols-3 gap-5">
        {STATUSES.map((s) => {
          const meta = STATUS_META[s];
          return (
            <section key={s}>
              <div className="flex items-center gap-2 mb-3">
                <span className={clsx("w-2.5 h-2.5 rounded-full shrink-0", meta.dot)} />
                <h2 className="text-[13px] font-semibold text-gray-700">{meta.label}</h2>
                <span className="ml-auto font-mono text-[10px] text-gray-400">{groups[s].length}</span>
              </div>
              <div className="space-y-1.5">
                {groups[s].slice(0, 40).map((t, i) => (
                  <article
                    key={i}
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    className={clsx(
                      "p-3 border border-gray-100 bg-gray-50 rounded-lg animate-rise",
                      s === "completed" && "opacity-50"
                    )}
                  >
                    <div className={clsx("text-[13.5px] text-gray-800 leading-snug", s === "completed" && "line-through")}>
                      {t.subject || <span className="italic text-gray-400">(untitled)</span>}
                    </div>
                    {t.description && (
                      <div className="text-[12px] text-gray-500 mt-1 leading-relaxed">{t.description}</div>
                    )}
                  </article>
                ))}
                {groups[s].length === 0 && (
                  <div className="text-gray-400 text-[12px] py-4 px-3 border border-dashed border-gray-200 rounded-lg italic text-center">
                    nothing here
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="px-8 pb-8">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Files</div>
        <div className="space-y-1">
          {data?.map((f) => (
            <details key={f.file} className="border border-gray-100 rounded-lg">
              <summary className="cursor-pointer px-4 py-2.5 flex gap-4 items-center hover:bg-gray-50 transition-colors rounded-lg">
                <span className="font-mono text-[11px] text-orange-500">{f.agentId?.slice(0, 8) || "—"}</span>
                <span className="text-[12.5px] text-gray-700">{f.todos.length} items</span>
                <span className="ml-auto font-mono text-[10.5px] text-gray-400">{formatTime(f.modified)}</span>
              </summary>
              <ul className="px-4 py-3 space-y-1 text-[12px] border-t border-gray-100">
                {f.todos.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={clsx("w-3 shrink-0 text-center", STATUS_META[t.status || "pending"]?.dot.replace("bg-", "text-"))}>
                      {STATUS_META[t.status || "pending"]?.sym}
                    </span>
                    <span className={clsx("text-gray-700", t.status === "completed" && "line-through opacity-60")}>
                      {t.subject}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
