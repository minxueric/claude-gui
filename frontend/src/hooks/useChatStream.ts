// Global chat store: SSE connections and state live OUTSIDE the React tree,
// keyed by chatId. Mounting/unmounting <ChatPage/> only attaches/detaches a
// subscription — connections stay open so a turn that's in flight when the
// user navigates away continues, and resuming the page restores the latest
// state instantly.
import { useEffect, useSyncExternalStore, useCallback, useRef } from "react";

export interface ChatBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "image" | "unknown";
  text?: string;
  thinking?: string;
  name?: string;
  input?: any;
  id?: string;
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
  source?: { type: "base64"; media_type: string; data: string };
}

export interface ChatTurn {
  role: "user" | "assistant" | "system" | "result";
  model?: string | null;
  blocks: ChatBlock[];
  ts: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: any;
  suggestions?: any;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd: number;
}

export interface UsageSnapshot {
  totals: UsageTotals;
  model: string | null;
}

export interface ChatStreamState {
  turns: ChatTurn[];
  pending?: PermissionRequest;          // head of pendingQueue, surfaced for UI
  pendingQueue?: PermissionRequest[];   // FIFO of all outstanding permission requests
  status: "idle" | "open" | "running" | "done" | "error";
  error?: string;
  usage?: UsageSnapshot;
  mode: string;
  sessionMissing?: boolean;
  lastEventAt?: number;   // ms since epoch; updated on every SSE event
}

interface Entry {
  state: ChatStreamState;
  es: EventSource | null;
  subscribers: Set<() => void>;
  initialMode: string;
}

const entries = new Map<string, Entry>();

function emptyState(initialMode: string): ChatStreamState {
  return { turns: [], status: "idle", mode: initialMode };
}

function notify(chatId: string) {
  const e = entries.get(chatId);
  if (!e) return;
  e.subscribers.forEach((cb) => cb());
}

function updateState(chatId: string, fn: (s: ChatStreamState) => ChatStreamState) {
  const e = entries.get(chatId);
  if (!e) return;
  e.state = fn(e.state);
  notify(chatId);
}

function openStream(chatId: string, e: Entry) {
  if (e.es) return;
  const es = new EventSource(`/api/chat/${chatId}/stream`);
  e.es = es;
  updateState(chatId, (s) => ({ ...s, status: "open" }));

  let probed = false;
  const probeMissing = async () => {
    if (probed) return;
    probed = true;
    try {
      const r = await fetch(`/api/chat/${chatId}/usage`);
      if (r.status === 404) {
        updateState(chatId, (s) => ({ ...s, status: "error", sessionMissing: true, error: "Session ended" }));
        es.close();
        e.es = null;
      }
    } catch { /* ignore */ }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) probeMissing();
  };

  const bump = () => updateState(chatId, (s) => ({ ...s, lastEventAt: Date.now() }));

  const push = (turn: ChatTurn) =>
    updateState(chatId, (s) => ({ ...s, turns: [...s.turns, turn], status: "running", lastEventAt: Date.now() }));

  es.addEventListener("user_message", () => { bump(); });
  es.addEventListener("assistant_message", (ev: MessageEvent) => {
    const d = JSON.parse(ev.data);
    push({ role: "assistant", model: d.model, blocks: d.content, ts: Date.now() / 1000 });
  });
  es.addEventListener("system", () => { bump(); });
  es.addEventListener("result", (ev: MessageEvent) => {
    const d = JSON.parse(ev.data);
    updateState(chatId, (s) => ({
      ...s,
      status: "idle",
      lastEventAt: Date.now(),
      turns: [
        ...s.turns,
        {
          role: "result",
          blocks: [{
            type: "text",
            text: `done · ${d.duration_ms ?? "?"}ms · $${d.total_cost_usd?.toFixed?.(4) ?? "?"}`,
          }],
          ts: Date.now() / 1000,
        },
      ],
    }));
  });
  es.addEventListener("usage", (ev: MessageEvent) => {
    try {
      const d = JSON.parse(ev.data) as UsageSnapshot;
      updateState(chatId, (s) => ({ ...s, usage: d, lastEventAt: Date.now() }));
    } catch {}
  });
  es.addEventListener("permission_request", (ev: MessageEvent) => {
    const d = JSON.parse(ev.data) as PermissionRequest;
    updateState(chatId, (s) => {
      const q = [...(s.pendingQueue || []), d];
      return { ...s, pendingQueue: q, pending: q[0], lastEventAt: Date.now() };
    });
  });
  es.addEventListener("ping", () => { bump(); });
  es.addEventListener("error", (ev: MessageEvent) => {
    try {
      const d = JSON.parse((ev as any).data || "{}");
      updateState(chatId, (s) => ({ ...s, status: "error", error: d.message, pending: undefined, pendingQueue: [], lastEventAt: Date.now() }));
    } catch {
      updateState(chatId, (s) => ({ ...s, status: "error", pending: undefined, pendingQueue: [], lastEventAt: Date.now() }));
    }
  });
  es.addEventListener("done", () => {
    updateState(chatId, (s) => ({ ...s, status: "idle", pending: undefined, pendingQueue: [], lastEventAt: Date.now() }));
  });
}

function ensureEntry(chatId: string, initialMode: string): Entry {
  let e = entries.get(chatId);
  if (e) return e;
  e = { state: emptyState(initialMode), es: null, subscribers: new Set(), initialMode };
  entries.set(chatId, e);
  openStream(chatId, e);
  // LRU eviction: keep at most MAX_ENTRIES live streams. Close anything
  // beyond that — running turns survive navigation, but we don't keep a
  // huge fleet of idle EventSources forever.
  const MAX_ENTRIES = 8;
  if (entries.size > MAX_ENTRIES) {
    const victims = [...entries.entries()]
      .filter(([id, ent]) => id !== chatId && ent.subscribers.size === 0 && ent.state.status !== "running")
      .slice(0, entries.size - MAX_ENTRIES);
    for (const [id] of victims) closeChatStream(id);
  }
  return e;
}

export function closeChatStream(chatId: string) {
  const e = entries.get(chatId);
  if (!e) return;
  if (e.es) { e.es.close(); e.es = null; }
  entries.delete(chatId);
}

export function useChatStream(chatId: string | null, initialMode: string = "default") {
  // Stable subscribe function tied to the current chatId
  const subscribe = useCallback((cb: () => void) => {
    if (!chatId) return () => {};
    const e = ensureEntry(chatId, initialMode);
    e.subscribers.add(cb);
    return () => {
      e.subscribers.delete(cb);
      // NOTE: we intentionally do NOT close the EventSource when the last
      // subscriber leaves. The stream survives navigation so a running turn
      // keeps progressing. Streams are closed explicitly via closeChatStream
      // (e.g. when the user starts a brand-new session).
    };
  }, [chatId, initialMode]);

  const getSnapshot = useCallback(() => {
    if (!chatId) return EMPTY;
    return ensureEntry(chatId, initialMode).state;
  }, [chatId, initialMode]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Keep a ref to the latest state for callbacks that need pending.requestId
  const stateRef = useRef(state);
  stateRef.current = state;

  const sendInput = useCallback(
    async (content: string | ChatBlock[]) => {
      if (!chatId) return;
      const userBlocks: ChatBlock[] = typeof content === "string"
        ? [{ type: "text", text: content }]
        : content;
      updateState(chatId, (s) => ({
        ...s,
        status: "running",
        lastEventAt: Date.now(),
        turns: [...s.turns, { role: "user", blocks: userBlocks, ts: Date.now() / 1000 }],
      }));
      const r = await fetch(`/api/chat/${chatId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        updateState(chatId, (s) => ({
          ...s,
          status: "error",
          error: r.status === 404 ? "Session ended — please start a new chat" : `${r.status} ${r.statusText}`,
          sessionMissing: r.status === 404,
        }));
      }
    },
    [chatId]
  );

  const respondPermission = useCallback(
    async (decision: "allow" | "deny" | "allow_once", messageOrInput?: any) => {
      if (!chatId) return;
      const pending = stateRef.current.pending;
      if (!pending) return;
      const body: any = { requestId: pending.requestId, decision };
      if (decision === "deny" && typeof messageOrInput === "string") {
        body.message = messageOrInput;
      } else if (messageOrInput !== undefined) {
        body.updatedInput = messageOrInput;
      }
      await fetch(`/api/chat/${chatId}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      updateState(chatId, (s) => {
        const q = (s.pendingQueue || []).filter((p) => p.requestId !== pending.requestId);
        return { ...s, pendingQueue: q, pending: q[0] };
      });
    },
    [chatId]
  );

  const interrupt = useCallback(async () => {
    if (!chatId) return;
    await fetch(`/api/chat/${chatId}/interrupt`, { method: "POST" });
  }, [chatId]);

  const setMode = useCallback(
    async (mode: string) => {
      // Always reflect the change locally so the dropdown UI updates even
      // before a backend session exists (lazy-start path).
      if (chatId) {
        updateState(chatId, (s) => ({ ...s, mode }));
      }
      if (!chatId) return;
      try {
        const r = await fetch(`/api/chat/${chatId}/permission_mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (r.ok) {
          const j = await r.json();
          updateState(chatId, (s) => ({ ...s, mode: j.mode || mode }));
        }
      } catch {
        updateState(chatId, (s) => ({ ...s, mode }));
      }
    },
    [chatId]
  );

  const setTurns = useCallback((turns: ChatTurn[]) => {
    if (!chatId) return;
    updateState(chatId, (s) => ({ ...s, turns }));
  }, [chatId]);

  // When chatId is unset (e.g. before resume's lazy start), expose dummy methods
  // and a transient state that callers can update via the "no chatId" branch.
  useEffect(() => {
    // No-op; useSyncExternalStore + subscribe handle attach/detach.
  }, [chatId]);

  return { state, sendInput, respondPermission, interrupt, setMode, setTurns };
}

const EMPTY: ChatStreamState = { turns: [], status: "idle", mode: "default" };
