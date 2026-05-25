import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Props {
  initialPath?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

export default function FolderPicker({ initialPath, onPick, onClose }: Props) {
  const [path, setPath] = useState(initialPath || "~");

  const { data, isLoading, error } = useQuery({
    queryKey: ["browse-folder", path],
    queryFn: () => api.browseFolder(path),
    retry: 0,
  });

  // Keep `path` in sync with backend's canonical (resolved) representation
  // so display matches what we'd actually use.
  useEffect(() => {
    if (data?.path && data.path !== path) setPath(data.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.path]);

  const segments = data ? data.path.split("/").filter(Boolean) : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col overflow-hidden border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-gray-900">Choose a directory</h2>
            <button
              onClick={onClose}
              className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-[16px] leading-none"
            >
              ×
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11.5px] font-mono">
            <button
              onClick={() => setPath("/")}
              className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-500"
            >
              /
            </button>
            {segments.map((seg, i) => {
              const partial = "/" + segments.slice(0, i + 1).join("/");
              const isLast = i === segments.length - 1;
              return (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="text-gray-300">›</span>
                  <button
                    onClick={() => setPath(partial)}
                    className={
                      "px-1.5 py-0.5 rounded hover:bg-gray-100 " +
                      (isLast ? "text-gray-900 font-semibold" : "text-gray-500")
                    }
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => data?.parent && setPath(data.parent)}
              disabled={!data?.parent}
              className="px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 text-[11px] font-medium disabled:opacity-40 transition-colors"
              title="Up one level"
            >
              ↑ Up
            </button>
            <button
              onClick={() => data?.home && setPath(data.home)}
              className="px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 text-[11px] font-medium transition-colors"
              title="Home directory"
            >
              ⌂ Home
            </button>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") { e.preventDefault(); }
              }}
              placeholder="/Users/you/Code"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1 text-[11.5px] font-mono outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading && <div className="px-3 py-4 text-[12px] text-gray-400">Loading…</div>}
          {error && <div className="px-3 py-4 text-[12px] text-red-500">Cannot read: {String((error as Error).message)}</div>}
          {data?.entries.length === 0 && !isLoading && (
            <div className="px-3 py-4 text-[12px] text-gray-400 italic">(empty)</div>
          )}
          {data?.entries.map((e) => (
            <button
              key={e.path}
              onClick={() => setPath(e.path)}
              onDoubleClick={() => onPick(e.path)}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-orange-50/60 rounded-md text-left font-mono text-[12px] text-gray-700 transition-colors"
            >
              <span className="text-[13px] shrink-0">📁</span>
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="text-[11px] text-gray-400 font-mono truncate flex-1 mr-3">{data?.path}</div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-gray-700 hover:bg-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => data?.path && onPick(data.path)}
              disabled={!data?.path}
              className="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[12.5px] font-medium disabled:opacity-40 transition-colors"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
