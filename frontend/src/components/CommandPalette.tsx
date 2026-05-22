import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, sessionTitle } from "../lib/api";
import { useShortcuts } from "../hooks/useShortcuts";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: "pages" | "projects" | "sessions" | "commands";
  go: () => void;
}

const PAGES: { path: string; label: string }[] = [
  { path: "/chat", label: "New Chat" },
  { path: "/search", label: "Search" },
  { path: "/todos", label: "Todos" },
  { path: "/tasks", label: "Tasks" },
  { path: "/plans", label: "Plans" },
  { path: "/stats", label: "Stats" },
  { path: "/memory", label: "Memory" },
];

function fuzzyScore(hay: string, q: string): number {
  if (!q) return 1;
  const H = hay.toLowerCase();
  const Q = q.toLowerCase();
  if (H.includes(Q)) return 2 + (H.startsWith(Q) ? 1 : 0);
  // subsequence test
  let i = 0;
  for (const c of H) {
    if (c === Q[i]) i++;
    if (i === Q.length) return 1;
  }
  return 0;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useShortcuts(
    [
      {
        combo: "mod+k",
        allowInInput: true,
        handler: () => {
          setOpen((o) => !o);
          setQ("");
          setActive(0);
        },
      },
      {
        combo: "esc",
        allowInInput: true,
        handler: () => (open ? (setOpen(false), true) : false),
      },
    ],
    [open]
  );

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    enabled: open,
  });
  const { data: sessions } = useQuery({
    queryKey: ["recent-sessions-palette"],
    queryFn: () => api.recentSessions(40),
    enabled: open,
  });
  const { data: commands } = useQuery({
    queryKey: ["commands-palette"],
    queryFn: () => api.commands(),
    enabled: open,
  });

  const items: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = [];
    for (const p of PAGES) {
      out.push({
        id: `page:${p.path}`,
        label: p.label,
        hint: p.path,
        group: "pages",
        go: () => navigate(p.path),
      });
    }
    for (const s of sessions || []) {
      out.push({
        id: `session:${s.sessionId}`,
        label: sessionTitle(s),
        hint: s.sessionId.slice(0, 8),
        group: "sessions",
        go: () => navigate(`/sessions/${s.sessionId}`),
      });
    }
    for (const c of commands || []) {
      out.push({
        id: `cmd:${c.scope}:${c.name}`,
        label: `/${c.name}`,
        hint: c.description || c.scope,
        group: "commands",
        go: () => navigate(`/chat`),
      });
    }
    return out;
  }, [projects, sessions, commands, navigate]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items.slice(0, 80);
    return items
      .map((it) => ({ it, s: Math.max(fuzzyScore(it.label, q), fuzzyScore(it.hint || "", q) * 0.7) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 80)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  const choose = (it: PaletteItem) => {
    setOpen(false);
    it.go();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-w-[92vw] bg-paper border border-rule shadow-lift rounded-sm animate-rise"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const it = filtered[active];
              if (it) choose(it);
            }
          }}
          placeholder="Jump to… (sessions · commands · pages)"
          className="w-full bg-transparent px-5 py-4 text-[15px] outline-none border-b border-rule"
        />
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-5 py-6 text-muted display-italic text-[14px]">no matches</div>
          )}
          {filtered.map((it, idx) => (
            <button
              key={it.id}
              onMouseEnter={() => setActive(idx)}
              onClick={() => choose(it)}
              className={
                "w-full text-left px-5 py-2 flex items-baseline gap-3 transition-colors " +
                (idx === active ? "bg-clayWash" : "hover:bg-rule/40")
              }
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted w-[68px] shrink-0">
                {it.group}
              </span>
              <span className="text-[14px] text-ink truncate flex-1">{it.label}</span>
              {it.hint && (
                <span className="font-mono text-[11px] text-ink2 truncate max-w-[40%]">{it.hint}</span>
              )}
            </button>
          ))}
        </div>
        <div className="px-5 py-2 border-t border-rule text-[10.5px] font-mono text-muted flex items-center gap-4">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">⌘K toggle</span>
        </div>
      </div>
    </div>
  );
}
