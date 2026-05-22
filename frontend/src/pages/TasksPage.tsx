import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, formatTime, TaskNode } from "../lib/api";
import clsx from "clsx";

function NodeView({ node }: { node: TaskNode }) {
  return (
    <details open={node.isDir} className="ml-3">
      <summary className="cursor-pointer text-[13px] py-0.5 hover:text-orange-500 transition-colors list-none flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-gray-400 w-3">{node.isDir ? "▾" : "·"}</span>
        <span className={clsx(node.isDir ? "font-semibold text-gray-800" : "text-gray-700")}>{node.name}</span>
        <span className="font-mono text-[10px] text-gray-400 ml-2">{formatTime(node.modified)}</span>
      </summary>
      {node.children?.map((c) => <NodeView key={c.path} node={c} />)}
    </details>
  );
}

export default function TasksPage() {
  const { taskId } = useParams();
  const list = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const detail = useQuery({ queryKey: ["task", taskId], queryFn: () => api.task(taskId!), enabled: !!taskId });

  return (
    <div className="h-full flex bg-white">
      <aside className="w-72 shrink-0 border-r border-gray-100 overflow-y-auto">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-[14px] font-semibold text-gray-900">Task artifacts</h2>
        </div>
        {list.data?.map((t, i) => (
          <Link
            key={t.path}
            to={`/tasks/${t.path}`}
            className={clsx(
              "flex items-start gap-3 px-5 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors",
              taskId === t.path && "bg-orange-50"
            )}
          >
            <span className="font-mono text-[10px] text-gray-300 w-5 shrink-0 pt-0.5 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className={clsx("text-[12.5px] font-medium truncate", taskId === t.path ? "text-orange-600" : "text-gray-800")}>{t.name}</div>
              <div className="font-mono text-[10px] text-gray-400 mt-0.5">{formatTime(t.modified)}</div>
            </div>
          </Link>
        ))}
        {list.data && list.data.length === 0 && (
          <div className="px-5 py-6 text-gray-400 text-[13px] italic">No tasks yet.</div>
        )}
      </aside>
      <div className="flex-1 overflow-y-auto">
        {!taskId && (
          <div className="h-full flex items-center justify-center text-gray-400 text-[15px] italic">
            Select a task.
          </div>
        )}
        {detail.data && (
          <div className="px-8 py-8 animate-rise">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Task</div>
            <h2 className="text-[18px] font-semibold text-gray-900 mb-5">{detail.data.name}</h2>
            <NodeView node={detail.data} />
          </div>
        )}
      </div>
    </div>
  );
}
