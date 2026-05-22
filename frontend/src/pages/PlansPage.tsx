import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, formatTime } from "../lib/api";
import MarkdownBlock from "../components/blocks/MarkdownBlock";
import clsx from "clsx";

export default function PlansPage() {
  const { name } = useParams();
  const list = useQuery({ queryKey: ["plans"], queryFn: api.plans });
  const detail = useQuery({ queryKey: ["plan", name], queryFn: () => api.plan(name!), enabled: !!name });

  return (
    <div className="h-full flex bg-white">
      <aside className="w-72 shrink-0 border-r border-gray-100 overflow-y-auto">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-gray-900">Plans</h2>
        </div>
        <div>
          {list.data?.map((p, i) => (
            <Link
              key={p.name}
              to={`/plans/${encodeURIComponent(p.name)}`}
              className={clsx(
                "flex items-start gap-3 px-5 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
                name === p.name && "bg-orange-50"
              )}
            >
              <span className="font-mono text-[10px] text-gray-300 w-5 shrink-0 pt-0.5 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className={clsx("text-[13px] font-medium leading-snug truncate", name === p.name ? "text-orange-600" : "text-gray-800")}>{p.title}</div>
                <div className="font-mono text-[10px] text-gray-400 truncate mt-0.5">{p.name}</div>
                <div className="font-mono text-[10px] text-gray-300 mt-0.5">{formatTime(p.modified)}</div>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <div className="flex-1 overflow-y-auto">
        {!name && (
          <div className="h-full flex items-center justify-center text-gray-400 text-[15px] italic">
            Select a plan to read.
          </div>
        )}
        {detail.data && (
          <article className="max-w-3xl mx-auto px-10 py-10 animate-rise">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Plan · {detail.data.name}</div>
            <MarkdownBlock text={detail.data.content} />
          </article>
        )}
      </div>
    </div>
  );
}
