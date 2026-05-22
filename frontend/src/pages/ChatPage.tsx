import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useChatStream, ChatTurn } from "../hooks/useChatStream";
import BlockList from "../components/chat/BlockList";
import AssistantTurnGroup from "../components/chat/AssistantTurnGroup";
import Composer, { nextMode, ComposerHandle } from "../components/chat/Composer";
import FileTreePanel from "../components/chat/FileTreePanel";
import UsageBadge from "../components/chat/UsageBadge";
import McpStatusPanel from "../components/chat/McpStatusPanel";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { messagesToTurns } from "../lib/messagesToTurns";

const EFFORT_OPTIONS = [
  { value: "", label: "Default", desc: "Standard" },
  { value: "low", label: "Low", desc: "Faster, less thinking" },
  { value: "medium", label: "Medium", desc: "Balanced" },
  { value: "high", label: "High", desc: "More thorough" },
  { value: "xhigh", label: "X-High", desc: "Extended thinking" },
  { value: "max", label: "Max", desc: "Maximum reasoning" },
] as const;

export default function ChatPage() {
  const [params] = useSearchParams();
  const resume = params.get("resume") || undefined;
  const initialCwd = params.get("cwd") || "";

  const [chatId, setChatId] = useState<string | null>(null);
  const [cwd, setCwd] = useState(initialCwd);
  const [model, setModel] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [effort, setEffort] = useState("");
  const [starting, setStarting] = useState(false);

  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [showFiles, setShowFiles] = useState(false);

  const { state, sendInput, respondPermission, interrupt, setMode, setTurns } = useChatStream(chatId, permissionMode);

  // History turns from JSONL polling (independent of the SSE store, so that
  // resumed sessions show their history even before the backend chat session
  // is lazily created on first send).
  const [historyTurns, setHistoryTurns] = useState<ChatTurn[]>([]);
  // Effective turns: use the live store when a backend chatId exists,
  // otherwise fall back to the JSONL-loaded history.
  const turns: ChatTurn[] = chatId ? state.turns : historyTurns;
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const turnRefs = useRef<Array<HTMLElement | null>>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  }, []);

  // Track scroll position to toggle the jump-to-bottom button
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setShowJumpToBottom(!isNearBottom() && turns.length > 0);
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatId, turns.length, isNearBottom]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, state.pending?.requestId]);

  // Load historical messages for resumed sessions, and poll for CLI updates.
  // Note: state.turns includes both live SSE events and historical ones; we
  // replace the whole array each refresh, which is fine because (a) historical
  // JSONL contains everything that's been persisted, (b) live SSE turns aren't
  // in JSONL yet (between fsync and reload), so we only replace when we're not
  // actively running. If a turn is in-flight (status=running), skip the
  // refresh to avoid clobbering optimistic state.
  const historyQ = useQuery({
    queryKey: ["session-history", resume || ""],
    queryFn: () => api.session(resume!),
    enabled: !!resume,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const loadedHistoryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resume || !historyQ.data) return;
    // Always reload on first arrival; subsequent polls only when idle to
    // avoid stomping in-flight optimistic turns.
    const firstLoad = loadedHistoryRef.current !== resume;
    if (!firstLoad && state.status === "running") return;
    const turns = messagesToTurns(historyQ.data.messages);
    setHistoryTurns(turns);
    // Also push into the live store (no-op when chatId is null, which is fine
    // — historyTurns is the source of truth in that case).
    if (chatId) setTurns(turns);
    loadedHistoryRef.current = resume;
  }, [historyQ.data, resume, state.status, setTurns, chatId]);

  const start = async () => {
    if (!cwd) return;
    const lockKey = resume ? `chat-start:${resume}` : null;
    // Reuse cached chatId only if the backend still has it (survives backend restarts).
    if (lockKey) {
      const cached = sessionStorage.getItem(lockKey);
      if (cached) {
        try {
          const probe = await fetch(`/api/chat/${cached}/usage`);
          if (probe.ok) {
            setChatId(cached);
            return;
          }
        } catch { /* fallthrough to create new session */ }
        sessionStorage.removeItem(lockKey);
      }
    }
    setStarting(true);
    try {
      const r = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd, resume,
          model: model || undefined,
          permissionMode,
          effort: effort || undefined,
        }),
      });
      const j = await r.json();
      if (lockKey && j.chatId) sessionStorage.setItem(lockKey, j.chatId);
      setChatId(j.chatId);
    } finally {
      setStarting(false);
    }
  };

  const startedRef = useRef(false);
  // NOTE: we DO NOT auto-start the backend session on resume anymore.
  // Reading history-only should not create a ClaudeSDKClient (which would
  // race with a CLI that may also be writing this session). The session is
  // lazily created when the user sends the first message.

  // If the backend lost the chatId (e.g. server restart), clear the cached
  // lock and start a fresh session automatically.
  useEffect(() => {
    if (!state.sessionMissing) return;
    if (resume) {
      sessionStorage.removeItem(`chat-start:${resume}`);
    }
    setChatId(null);
    startedRef.current = false;
    // Kick off a new session immediately, regardless of whether this was a resume.
    if (cwd) {
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionMissing]);

  // Pending message to send once the backend session is ready (for lazy resume).
  const pendingSendRef = useRef<string | import("../hooks/useChatStream").ChatBlock[] | null>(null);

  useEffect(() => {
    if (!chatId) return;
    // Seed the live store with the JSONL history the moment a backend session
    // is created — otherwise switching from `historyTurns` to `state.turns`
    // would make the screen look empty until the next history poll lands.
    if (historyTurns.length > 0) {
      setTurns(historyTurns);
    }
    if (pendingSendRef.current === null) return;
    const c = pendingSendRef.current;
    pendingSendRef.current = null;
    void sendInput(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const onSend = async (content: string | import("../hooks/useChatStream").ChatBlock[]) => {
    if (chatId) {
      await sendInput(content);
      return;
    }
    // Lazy-start: queue the message, then create a backend session.
    pendingSendRef.current = content;
    if (!starting) {
      await start();
    }
  };

  const cycleMode = () => setMode(nextMode(state.mode));

  // ── Start form ─────────────────────────────────────────────────────────────
  // Skip the start form for resumed sessions — we have history & cwd already,
  // and the backend session is created lazily on first send.
  if (!chatId && !resume) {
    return (
      <div className="h-full flex items-center justify-center px-8 py-10 bg-white">
        <form
          onSubmit={(e) => { e.preventDefault(); start(); }}
          className="w-full max-w-xl animate-rise"
        >
          <h1 className="text-[24px] font-semibold text-gray-900 mb-1">New chat</h1>
          <p className="text-[13px] text-gray-400 mb-7">Start a Claude Code session in any directory.</p>

          {resume && (
            <p className="text-gray-600 mb-5 text-[13px]">
              Resuming{" "}
              <span className="font-mono text-[11px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded">
                {resume.slice(0, 8)}
              </span>
            </p>
          )}

          <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-xl p-5">
            <Field label="Working directory">
              <div className="flex gap-2">
                <input
                  list="projects-list"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="/Users/you/Code/your-project"
                  className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.pickFolder();
                    if (res.path) setCwd(res.path);
                  }}
                  title="Browse for folder"
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-orange-600 hover:border-orange-300 transition-colors text-[14px]"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M1.5 3.5h4l1.5 2h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-9Z" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              <datalist id="projects-list">
                {projects?.map((p) => <option key={p.encoded} value={p.cwd} />)}
              </datalist>
            </Field>

            <Field label="Model">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="default (claude-opus-4-7)"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
              />
            </Field>

            {/* Effort selector */}
            <Field label="Thinking effort">
              <div className="grid grid-cols-3 gap-1.5">
                {EFFORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setEffort(o.value)}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                      effort === o.value
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-[12px] font-medium">{o.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{o.desc}</div>
                  </button>
                ))}
              </div>
            </Field>

            {/* Permission mode */}
            <Field label="Permission mode">
              <div className="grid grid-cols-4 gap-1.5">
                {(["default", "acceptEdits", "bypassPermissions", "plan"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPermissionMode(m)}
                    className={`px-2 py-2 rounded-lg border text-center transition-colors ${
                      permissionMode === m
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-[11px] font-medium leading-snug">{m}</div>
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <button
            disabled={!cwd || starting}
            className="mt-4 w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-xl disabled:opacity-50 transition-colors text-[14px] inline-flex items-center justify-center gap-2"
          >
            {starting ? "Starting…" : "Start chat →"}
          </button>
        </form>
      </div>
    );
  }

  // ── Active chat ────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-white">
      <header className="px-5 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-gray-900">Conversation</span>
        {chatId ? (
          <span className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {chatId.slice(0, 8)}
          </span>
        ) : resume ? (
          <span className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {resume.slice(0, 8)}
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-gray-400 truncate max-w-[280px]">{cwd}</span>
        {state.usage && <UsageBadge totals={state.usage.totals} />}
        <McpStatusPanel chatId={chatId} />
        <div className="ml-auto flex items-center gap-1.5">
          {cwd && (
            <button
              onClick={() => setShowFiles((v) => !v)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                showFiles ? "border-orange-300 text-orange-600 bg-orange-50" : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              Files
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col relative">
          <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
            <div className="max-w-[1080px] mx-auto w-full">
            {turns.length === 0 && (
              <div className="px-8 py-16 text-gray-400 text-[14px] italic text-center">
                Waiting for the first message…
              </div>
            )}
            {(() => {
              // First pass: find the start index of the last assistant group
              let lastGroupStart = -1;
              {
                let inGroup = false;
                turns.forEach((t, i) => {
                  if (t.role === "user") {
                    inGroup = false;
                  } else {
                    if (!inGroup) {
                      lastGroupStart = i;
                      inGroup = true;
                    }
                  }
                });
              }

              const elements: JSX.Element[] = [];
              let buffer: ChatTurn[] = [];
              let bufferStart = 0;

              const flush = () => {
                if (buffer.length === 0) return;
                const start = bufferStart;
                const group = buffer;
                const isLast = start === lastGroupStart;
                elements.push(
                  <div key={`g-${start}`} ref={(el) => (turnRefs.current[start] = el)} data-turn-index={start}>
                    <AssistantTurnGroup
                      turns={group}
                      cwd={cwd}
                      pending={isLast ? state.pending : undefined}
                      onDecide={isLast ? respondPermission : undefined}
                    />
                  </div>
                );
                buffer = [];
              };

              turns.forEach((t, i) => {
                if (t.role === "user") {
                  flush();
                  elements.push(
                    <article
                      key={i}
                      ref={(el) => (turnRefs.current[i] = el)}
                      data-turn-index={i}
                      className="px-6 py-4 flex justify-end gap-3"
                    >
                      <div className="max-w-[72%] flex flex-col items-end">
                        <div className="text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">You</div>
                        {/* Light bubble: orange-tinted border, off-white bg */}
                        <div className="user-bubble bg-orange-500 px-4 py-2 rounded-2xl rounded-tr-sm text-[13.5px] font-medium leading-relaxed text-white whitespace-pre-wrap break-words">
                          <BlockList blocks={t.blocks} cwd={cwd} />
                        </div>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0 mt-7 text-[12px] font-semibold text-orange-600 select-none">
                        U
                      </div>
                    </article>
                  );
                } else {
                  if (buffer.length === 0) bufferStart = i;
                  buffer.push(t);
                }
              });
              flush();
              return elements;
            })()}
            <div ref={endRef} />
            </div>
          </div>

          {showJumpToBottom && (
            <button
              onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
              title="Jump to latest"
              className="absolute right-6 bottom-[120px] z-10 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md text-gray-600 hover:text-orange-600 hover:border-orange-300 transition-colors flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3 v10 M3 8 l5 5 l5 -5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          <Composer
            ref={composerRef}
            cwd={cwd}
            mode={state.mode}
            onCycleMode={cycleMode}
            onSelectMode={(m) => setMode(m)}
            effort={effort}
            onSelectEffort={(e) => { setEffort(e); if (chatId) void api.setEffort(chatId, e); }}
            onSend={onSend}
            status={state.status}
            onInterrupt={interrupt}
          />
        </div>

        {cwd && showFiles && (
          <FileTreePanel cwd={cwd} turns={turns} onPick={(p) => composerRef.current?.injectMention(p)} />
        )}
      </div>

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</div>
      {children}
    </label>
  );
}
