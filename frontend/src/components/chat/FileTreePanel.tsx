import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFileTree } from "../../hooks/useCwdFiles";
import { TreeEntry, FileMatch, api } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useFilePreview } from "./FilePreviewContext";
import { ChatTurn } from "../../hooks/useChatStream";

interface Props {
  cwd: string;
  onPick?: (path: string) => void;
  turns?: ChatTurn[];
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx"].includes(ext)) return "📘";
  if (["js", "jsx"].includes(ext)) return "📙";
  if (["py"].includes(ext)) return "🐍";
  if (["md", "mdx"].includes(ext)) return "📝";
  if (["json"].includes(ext)) return "{}";
  if (["css", "scss"].includes(ext)) return "🎨";
  if (["html"].includes(ext)) return "🌐";
  if (["sh", "bash"].includes(ext)) return "⚡";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "🖼";
  if (["pdf"].includes(ext)) return "📕";
  return "📄";
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

function FolderNode({
  cwd, entry, onPick, onPreview, onContextMenu, depth,
}: {
  cwd: string;
  entry: TreeEntry;
  onPick?: (path: string) => void;
  onPreview: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useFileTree(open ? cwd : undefined, entry.path);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className="w-full text-left flex items-center gap-1.5 py-1 hover:bg-gray-50 rounded-md transition-colors font-mono text-[12px] text-gray-600"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="text-gray-400 text-[9px] w-3 shrink-0 transition-transform" style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        <span className="text-[13px]">📁</span>
        <span className="truncate">{entry.name}</span>
      </button>
      {open && data && (
        <div>
          {data.entries.map((e) => (
            <EntryNode key={e.path} cwd={cwd} entry={e} onPick={onPick} onPreview={onPreview} onContextMenu={onContextMenu} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileEntry({
  entry, onPick, onPreview, onContextMenu, depth,
}: {
  entry: TreeEntry;
  onPick?: (path: string) => void;
  onPreview: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  depth: number;
}) {
  return (
    <div
      className="group w-full flex items-center gap-1.5 py-1 hover:bg-gray-50 rounded-md transition-colors font-mono text-[12px] text-gray-600 cursor-pointer"
      style={{ paddingLeft: 8 + depth * 14 + 16 }}
      onClick={() => onPreview(entry.path)}
      onContextMenu={(e) => onContextMenu(e, entry)}
    >
      <span className="text-[13px] shrink-0">{fileIcon(entry.name)}</span>
      <span className="truncate flex-1">{entry.name}</span>
      <button
        className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-orange-500 px-1.5 py-0.5 rounded shrink-0 mr-1 transition-all"
        onClick={(e) => { e.stopPropagation(); onPick?.(entry.path); }}
        title="Mention in chat"
      >
        @
      </button>
    </div>
  );
}

function EntryNode({
  cwd, entry, onPick, onPreview, onContextMenu, depth,
}: {
  cwd: string;
  entry: TreeEntry;
  onPick?: (path: string) => void;
  onPreview: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  depth: number;
}) {
  if (entry.isDir) return <FolderNode cwd={cwd} entry={entry} onPick={onPick} onPreview={onPreview} onContextMenu={onContextMenu} depth={depth} />;
  return <FileEntry entry={entry} onPick={onPick} onPreview={onPreview} onContextMenu={onContextMenu} depth={depth} />;
}

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

interface RecentEdit {
  path: string;
  tool: string;
  ts: number;
}

function recentEditsFromTurns(turns: ChatTurn[] | undefined): RecentEdit[] {
  if (!turns) return [];
  const seen = new Set<string>();
  const out: RecentEdit[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "assistant") continue;
    for (const b of t.blocks) {
      if (b.type !== "tool_use" || !b.name) continue;
      if (!DIFF_TOOLS.has(b.name)) continue;
      const fp = typeof b.input?.file_path === "string" ? b.input.file_path : undefined;
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      out.push({ path: fp, tool: b.name, ts: t.ts });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

export default function FileTreePanel({ cwd, onPick, turns }: Props) {
  const qc = useQueryClient();
  const filePreview = useFilePreview();
  const { data, isLoading, error, refetch } = useFileTree(cwd, "");
  const [width, setWidth] = useState(280);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const [query, setQuery] = useState("");
  const searchEnabled = query.trim().length > 0;
  const { data: matches } = useQuery({
    queryKey: ["file-match", cwd, query],
    queryFn: () => api.fileMatch(cwd, query, 50),
    enabled: searchEnabled,
    staleTime: 1500,
  });

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const recentEdits = useMemo(() => recentEditsFromTurns(turns), [turns]);
  const [editsOpen, setEditsOpen] = useState(true);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      setWidth(Math.max(220, Math.min(640, startW.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  }, [width]);

  useEffect(() => {
    if (cwd) qc.invalidateQueries({ queryKey: ["files-tree", cwd] });
  }, [cwd]);

  const openPreview = useCallback((path: string) => {
    if (!filePreview) return;
    filePreview.open({ cwd, path });
  }, [filePreview, cwd]);

  const openContextMenu = useCallback((e: React.MouseEvent, entry: TreeEntry) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.isDir });
  }, []);

  const cwdName = cwd.split("/").filter(Boolean).pop() || cwd;

  if (!cwd) return null;

  return (
    <aside className="h-full border-l border-gray-100 bg-white flex flex-col relative shrink-0" style={{ width }}>
      <div
        onMouseDown={onMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-orange-300 transition-colors z-20"
      />

      {/* Header: title + cwd */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Files</div>
          <button
            onClick={() => api.fileReveal(cwd, ".").catch(() => {})}
            title="Reveal cwd in Finder"
            className="ml-auto text-[10px] text-gray-400 hover:text-orange-500 px-1.5 py-0.5 rounded hover:bg-gray-50 transition-colors"
          >
            Reveal ⤴
          </button>
        </div>
        <div className="text-[11px] text-gray-700 font-mono truncate mt-0.5" title={cwd}>{cwdName}</div>
      </div>

      {/* Search box */}
      <div className="px-2 py-2 border-b border-gray-100">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="w-full bg-gray-50 border border-gray-200 rounded-md pl-7 pr-2 py-1.5 text-[12px] outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 transition-colors"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 pointer-events-none">⌕</span>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 hover:text-gray-700 w-4 h-4 flex items-center justify-center"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Recent edits */}
      {recentEdits.length > 0 && !searchEnabled && (
        <div className="border-b border-gray-100">
          <button
            onClick={() => setEditsOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-gray-50 transition-colors"
          >
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Recent edits</span>
            <span className="text-[10px] text-gray-300">· {recentEdits.length}</span>
            <span className="ml-auto text-gray-400 text-[10px]">{editsOpen ? "▾" : "▸"}</span>
          </button>
          {editsOpen && (
            <div className="pb-1.5">
              {recentEdits.map((re) => (
                <button
                  key={re.path}
                  onClick={() => openPreview(re.path)}
                  className="w-full flex items-center gap-1.5 px-3 py-1 hover:bg-gray-50 text-left font-mono text-[11px] text-gray-600"
                >
                  <span className="text-orange-500 shrink-0">⚙</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{re.tool}</span>
                  <span className="truncate flex-1" title={re.path}>{re.path.split("/").pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body: tree OR search results */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {searchEnabled ? (
          <SearchResults matches={matches || []} onPreview={openPreview} onPick={onPick} onContextMenu={openContextMenu} cwd={cwd} />
        ) : (
          <>
            {isLoading && <div className="px-3 text-[11px] text-gray-400">loading…</div>}
            {error && (
              <div className="px-3 py-2">
                <div className="text-[11px] text-red-400 mb-2">Failed to load files</div>
                <button onClick={() => refetch()} className="text-[11px] text-orange-500 hover:text-orange-600 underline">Retry</button>
              </div>
            )}
            {data?.entries.map((e) => (
              <EntryNode
                key={e.path}
                cwd={cwd}
                entry={e}
                onPick={onPick}
                onPreview={openPreview}
                onContextMenu={openContextMenu}
                depth={0}
              />
            ))}
          </>
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <ContextMenu
          menu={menu}
          cwd={cwd}
          onPick={onPick}
          onPreview={openPreview}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

function SearchResults({
  matches, onPreview, onPick, onContextMenu, cwd,
}: {
  matches: FileMatch[];
  onPreview: (path: string) => void;
  onPick?: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: TreeEntry) => void;
  cwd: string;
}) {
  void cwd;
  if (matches.length === 0) {
    return <div className="px-3 py-4 text-[11px] text-gray-400 italic">No matches</div>;
  }
  return (
    <div>
      {matches.map((m) => (
        <div
          key={m.path}
          className="group flex items-center gap-1.5 py-1 px-2 hover:bg-gray-50 rounded-md cursor-pointer font-mono text-[12px] text-gray-600"
          onClick={() => !m.isDir && onPreview(m.path)}
          onContextMenu={(e) => onContextMenu(e, { name: m.name, path: m.path, isDir: m.isDir, size: null, modified: null })}
        >
          <span className="text-[13px] shrink-0">{m.isDir ? "📁" : fileIcon(m.name)}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate">{m.name}</div>
            <div className="truncate text-[10px] text-gray-400">{m.path}</div>
          </div>
          {onPick && (
            <button
              className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-orange-500 px-1.5 py-0.5 rounded shrink-0 transition-all"
              onClick={(e) => { e.stopPropagation(); onPick(m.path); }}
              title="Mention in chat"
            >
              @
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ContextMenu({
  menu, cwd, onPick, onPreview, onClose,
}: {
  menu: ContextMenuState;
  cwd: string;
  onPick?: (path: string) => void;
  onPreview: (path: string) => void;
  onClose: () => void;
}) {
  const items = [
    !menu.isDir && {
      label: "Preview",
      onClick: () => { onPreview(menu.path); onClose(); },
    },
    onPick && {
      label: "Mention in chat (@)",
      onClick: () => { onPick(menu.path); onClose(); },
    },
    {
      label: "Copy path",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(menu.path);
          toast.success("Path copied");
        } catch (e) {
          toast.error("Copy failed", { description: (e as Error).message });
        }
        onClose();
      },
    },
    {
      label: "Reveal in Finder",
      onClick: async () => {
        try {
          await api.fileReveal(cwd, menu.path);
        } catch (e) {
          toast.error("Reveal failed", { description: (e as Error).message });
        }
        onClose();
      },
    },
  ].filter(Boolean) as { label: string; onClick: () => void }[];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] text-[12px]"
        style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 200) }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            onClick={it.onClick}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
