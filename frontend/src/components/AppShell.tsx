import { useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, sessionTitle, formatTime, SessionSummary } from "../lib/api";
import clsx from "clsx";
import CommandPalette from "./CommandPalette";
import ShortcutsOverlay from "./ShortcutsOverlay";

const PRIMARY_NAV: { to: string; label: string; icon: string }[] = [
  { to: "/chat", label: "New Chat", icon: "+" },
  { to: "/search", label: "Search", icon: "⌕" },
];
const SECONDARY_NAV: { to: string; label: string; icon: string }[] = [
  { to: "/todos", label: "Todos", icon: "☐" },
  { to: "/tasks", label: "Tasks", icon: "◈" },
  { to: "/plans", label: "Plans", icon: "≡" },
  { to: "/stats", label: "Stats", icon: "↗" },
  { to: "/memory", label: "Memory", icon: "◎" },
];

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isActiveSecondary = SECONDARY_NAV.some((n) => loc.pathname.startsWith(n.to));
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[13px] font-medium",
          isActiveSecondary
            ? "bg-orange-50 text-orange-700"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        )}
      >
        <span className="text-[14px] w-4 text-center shrink-0">⋯</span>
        <span>More</span>
        <span className="ml-auto text-[10px] text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            {SECONDARY_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 px-3 py-1.5 text-[12.5px]",
                    isActive
                      ? "bg-orange-50 text-orange-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )
                }
              >
                <span className="text-[13px] w-4 text-center shrink-0">{n.icon}</span>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function groupByProject(sessions: SessionSummary[]): Map<string, { name: string; sessions: SessionSummary[] }> {
  const map = new Map<string, { name: string; sessions: SessionSummary[] }>();
  for (const s of sessions) {
    const key = s.encodedProject || "__unknown__";
    const name = s.projectPath?.split("/").filter(Boolean).pop() || s.encodedProject || "Unknown";
    if (!map.has(key)) map.set(key, { name, sessions: [] });
    map.get(key)!.sessions.push(s);
  }
  return map;
}

function SessionRow({ s, isActive, isLive }: { s: SessionSummary; isActive: boolean; isLive: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sessionTitle(s));
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const submitRename = async () => {
    const v = draft.trim();
    setEditing(false);
    if (!v || v === sessionTitle(s)) return;
    try {
      await api.renameSession(s.sessionId, v);
      qc.invalidateQueries({ queryKey: ["recent-sessions"] });
    } catch (e) {
      console.error("rename failed", e);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteSession(s.sessionId);
      qc.invalidateQueries({ queryKey: ["recent-sessions"] });
      setConfirmDelete(false);
      if (isActive) navigate("/chat");
    } catch (e) {
      console.error("delete failed", e);
      setDeleting(false);
    }
  };

  const title = sessionTitle(s);
  const to = `/chat?resume=${s.sessionId}&cwd=${encodeURIComponent(s.projectPath || "")}`;

  return (
    <div className="group relative">
      {editing ? (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") { setEditing(false); setDraft(title); }
            }}
            onBlur={submitRename}
            className="flex-1 min-w-0 bg-white border border-orange-300 focus:ring-2 focus:ring-orange-100 rounded-md px-2 py-1 text-[12px] outline-none"
          />
        </div>
      ) : (
        <NavLink
          to={to}
          title={title}
          className={clsx(
            "block px-2 py-1.5 rounded-md transition-colors",
            isActive ? "bg-orange-50 text-orange-700" : "hover:bg-gray-50 text-gray-600"
          )}
        >
          <div className="flex items-start gap-1.5">
            {isLive && (
              <span className="relative flex h-2 w-2 mt-1 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 animate-ping opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            <div className="text-[12px] leading-snug line-clamp-2 font-medium flex-1 pr-5">
              {title}
            </div>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-gray-400">
            {formatTime(s.modified)}
          </div>
        </NavLink>
      )}

      {/* Action button (visible on hover) */}
      {!editing && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="absolute right-1 top-1.5 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Session actions"
        >
          ⋯
        </button>
      )}

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-1 top-7 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-32 text-[12px]">
            <button
              onClick={() => { setMenuOpen(false); setEditing(true); setDraft(title); }}
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
            >
              Rename
            </button>
            <button
              onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-500"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {confirmDelete && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm animate-fade"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[92vw] border border-gray-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                  <path d="M3 6h18M19 6l-1.5 14a2 2 0 0 1-2 1.8h-7a2 2 0 0 1-2-1.8L5 6M10 11v6M14 11v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-semibold text-gray-900">Delete session?</h3>
                <p className="text-[12.5px] text-gray-500 mt-1 leading-relaxed">
                  This removes the JSONL file from disk and cannot be undone.
                </p>
                <div className="mt-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-[12.5px] text-gray-800 font-medium truncate">{title}</div>
                  <div className="text-[10.5px] text-gray-400 font-mono mt-0.5">
                    {s.sessionId.slice(0, 8)} · {formatTime(s.modified)}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="px-3.5 py-1.5 rounded-lg border border-gray-200 text-[13px] font-medium text-gray-700 hover:bg-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={doDelete}
                className="px-3.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[13px] font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {deleting && (
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ProjectGroup({
  name,
  sessions,
  activeSessionId,
  activeSessionIds,
  defaultOpen,
}: {
  name: string;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSessionIds: Set<string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 rounded-md transition-colors group"
      >
        <span className="text-gray-400 text-[10px] w-3 shrink-0 transition-transform" style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        <span className="text-[12px] font-semibold text-gray-500 truncate flex-1">{name}</span>
        <span className="text-[10px] text-gray-300 shrink-0">{sessions.length}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-gray-100 pl-2">
          {sessions.map((s) => (
            <SessionRow
              key={s.sessionId}
              s={s}
              isActive={activeSessionId === s.sessionId}
              isLive={activeSessionIds.has(s.sessionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { data: recent } = useQuery({
    queryKey: ["recent-sessions"],
    queryFn: () => api.recentSessions(60),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const { data: activeData } = useQuery({
    queryKey: ["active-chats"],
    queryFn: () => api.activeChats(),
    refetchInterval: 3_000,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const activeSessionId = loc.pathname.startsWith("/sessions/")
    ? loc.pathname.split("/")[2]
    : loc.pathname === "/chat"
    ? params.get("resume")
    : null;

  const groups = recent ? groupByProject(recent) : new Map<string, { name: string; sessions: SessionSummary[] }>();
  const activeProject = recent?.find((s) => s.sessionId === activeSessionId)?.encodedProject;
  const activeSessionIds = new Set(
    (activeData?.sessions || []).map((a) => a.sessionId).filter(Boolean) as string[]
  );

  return (
    <div className="flex h-full bg-white">
      {/* Sidebar */}
      <aside className="w-[260px] shrink-0 flex flex-col border-r border-gray-100 bg-white">
        {/* Brand */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L13 5.5V10.5L8 14L3 10.5V5.5L8 2Z" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
            <div>
              <div className="text-[14px] font-semibold text-gray-900 leading-none">Claude</div>
              <div className="text-[10px] text-gray-400 mt-0.5">local GUI</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="px-3 py-3 border-b border-gray-100 space-y-0.5">
          {PRIMARY_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[13px] font-medium",
                  isActive
                    ? "bg-orange-50 text-orange-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )
              }
            >
              <span className="text-[14px] w-4 text-center shrink-0">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
          <MoreMenu />
        </nav>

        {/* Recent sessions grouped by project */}
        <div className="px-3 pt-3 pb-1">
          <div className="eyebrow text-[10px] px-1 mb-2">Recent</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {[...groups.entries()].map(([key, { name, sessions }]) => (
            <ProjectGroup
              key={key}
              name={name}
              sessions={sessions}
              activeSessionId={activeSessionId}
              activeSessionIds={activeSessionIds}
              defaultOpen={key === activeProject || sessions.some((s) => s.sessionId === activeSessionId)}
            />
          ))}
          {recent && recent.length === 0 && (
            <div className="px-3 py-6 text-gray-400 text-[12px] text-center">
              No sessions yet
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">v0.1</span>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-gray-50">
        <Outlet />
      </main>
      <CommandPalette />
      <ShortcutsOverlay />
    </div>
  );
}
