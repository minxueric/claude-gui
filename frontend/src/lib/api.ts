// API client + shared types

export interface ProjectInfo {
  encoded: string;
  cwd: string;
  sessionCount: number;
  lastModified: number | null;
}

export interface SessionSummary {
  sessionId: string;
  encodedProject: string;
  firstPrompt: string | null;
  summary: string | null;
  messageCount: number | null;
  created: number | null;
  modified: number | null;
  gitBranch: string | null;
  projectPath: string | null;
  isSidechain: boolean;
}

export interface MessageRow {
  uuid: string;
  sessionId: string;
  parentUuid: string | null;
  ts: number | null;
  role: string;
  model: string | null;
  toolName: string | null;
  cwd: string | null;
  gitBranch: string | null;
  hasThinking: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  preview: string | null;
  raw: any | null;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: MessageRow[];
  nextCursor: string | null;
}

export interface SearchHit {
  sessionId: string;
  uuid: string;
  ts: number | null;
  role: string;
  toolName: string | null;
  snippet: string;
  sessionFirstPrompt: string | null;
  encodedProject: string | null;
}

export interface SearchResponse {
  total: number;
  hits: SearchHit[];
}

export interface TodoItem {
  id: string | null;
  subject: string | null;
  description: string | null;
  status: string | null;
  activeForm: string | null;
}

export interface TodosFile {
  file: string;
  agentId: string | null;
  modified: number;
  todos: TodoItem[];
}

export interface PlanFile {
  name: string;
  title: string;
  modified: number;
  size: number;
}

export interface TaskNode {
  name: string;
  path: string;
  isDir: boolean;
  modified: number;
  size: number | null;
  children: TaskNode[] | null;
}

export interface SlashCommand {
  scope: "builtin" | "user" | "project";
  name: string;
  description: string;
  argumentHint: string | null;
  allowedTools: string[];
  body: string;
  source: string | null;
}

export interface FileMatch {
  path: string;
  name: string;
  isDir: boolean;
  score: number;
}

export interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
}

export interface TreeResponse {
  cwd: string;
  path: string;
  entries: TreeEntry[];
}

export interface FileReadResponse {
  cwd: string;
  path: string;
  size: number;
  truncated: boolean;
  text: string;
}

export interface MemoryDoc {
  scope: "project" | "user";
  path: string;
  exists: boolean;
  text: string;
}

export interface MemoryResponse {
  project: MemoryDoc | null;
  user: MemoryDoc;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("JSON parse failed for", url, "response:", text.slice(0, 200));
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 100)}`);
  }
}

export const api = {
  projects: () => get<ProjectInfo[]>("/api/projects"),
  recentSessions: (limit = 40) => get<SessionSummary[]>(`/api/sessions?limit=${limit}`),
  activeChats: () => get<{ sessions: { chatId: string; sessionId: string | null }[] }>("/api/chat/active"),
  pickFolder: () => get<{ path: string | null }>("/api/files/pick-folder"),
  sessions: (encoded: string, q?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("limit", "500");
    return get<SessionSummary[]>(`/api/projects/${encodeURIComponent(encoded)}/sessions?${sp}`);
  },
  session: (id: string) => get<SessionDetail>(`/api/sessions/${id}?limit=5000&includeRaw=true`),
  renameSession: async (id: string, summary: string) => {
    const r = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean; summary: string }>;
  },
  deleteSession: async (id: string) => {
    const r = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean }>;
  },
  search: (params: {
    q: string;
    project?: string;
    role?: string;
    model?: string;
    tool?: string;
    fromTs?: number;
    toTs?: number;
    hasThinking?: boolean;
    hasToolUse?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    });
    return get<SearchResponse>(`/api/search?${sp}`);
  },
  facets: (project?: string) =>
    get<{ models: string[]; tools: string[]; branches: string[]; roles: string[] }>(
      `/api/search/facets${project ? `?project=${encodeURIComponent(project)}` : ""}`
    ),
  todos: () => get<TodosFile[]>("/api/todos"),
  tasks: () => get<TaskNode[]>("/api/tasks"),
  task: (id: string) => get<TaskNode>(`/api/tasks/${id}`),
  taskFile: (id: string, path: string) =>
    get<{ truncated: boolean; size: number; content: string }>(
      `/api/tasks/${id}/file?path=${encodeURIComponent(path)}`
    ),
  plans: () => get<PlanFile[]>("/api/plans"),
  plan: (name: string) => get<{ name: string; content: string; modified: number }>(`/api/plans/${name}`),
  commands: (cwd?: string) =>
    get<SlashCommand[]>(`/api/commands${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  fileTree: (cwd: string, path: string = "") => {
    const b64 = btoa(unescape(encodeURIComponent(cwd)));
    return get<TreeResponse>(`/api/files/tree?cwd=${b64}&path=${encodeURIComponent(path)}&encoding=base64`);
  },
  fileMatch: (cwd: string, q: string, limit = 30) => {
    const b64 = btoa(unescape(encodeURIComponent(cwd)));
    return get<FileMatch[]>(`/api/files/match?cwd=${b64}&q=${encodeURIComponent(q)}&limit=${limit}&encoding=base64`);
  },
  fileRead: (cwd: string, path: string) => {
    const b64 = btoa(unescape(encodeURIComponent(cwd)));
    return get<FileReadResponse>(`/api/files/read?cwd=${b64}&path=${encodeURIComponent(path)}&encoding=base64`);
  },
  fileReveal: async (cwd: string, path: string) => {
    const b64 = btoa(unescape(encodeURIComponent(cwd)));
    const r = await fetch("/api/files/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: b64, path, encoding: "base64" }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean }>;
  },
  memory: (cwd?: string) =>
    get<MemoryResponse>(`/api/memory${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  memoryAppend: async (cwd: string, line: string, scope: "project" | "user" = "project") => {
    const r = await fetch("/api/memory/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, line, scope }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  },
  memorySave: async (cwd: string, scope: "project" | "user", text: string) => {
    const r = await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, scope, text }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  },
  setPermissionMode: async (chatId: string, mode: string) => {
    const r = await fetch(`/api/chat/${chatId}/permission_mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean; mode: string }>;
  },
  setEffort: async (chatId: string, effort: string) => {
    const r = await fetch(`/api/chat/${chatId}/effort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean; effort: string | null }>;
  },
  setModel: async (chatId: string, model: string) => {
    const r = await fetch(`/api/chat/${chatId}/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<{ ok: boolean; model: string | null }>;
  },
  chatUsage: (chatId: string) =>
    get<{ totals: Record<string, number>; model: string | null }>(`/api/chat/${chatId}/usage`),
  chatMcp: (chatId: string) =>
    get<{ status: any; available: boolean }>(`/api/chat/${chatId}/mcp`),
  statsDaily: (days = 30) =>
    get<{ days: number; series: StatsDailyPoint[] }>(`/api/stats/daily?days=${days}`),
  statsModels: (days = 30) =>
    get<{ days: number; models: StatsModelRow[] }>(`/api/stats/models?days=${days}`),
  statsTools: (days = 30, limit = 15) =>
    get<{ days: number; tools: StatsToolRow[] }>(`/api/stats/tools?days=${days}&limit=${limit}`),
  statsTotals: (days = 30) =>
    get<StatsTotals>(`/api/stats/totals?days=${days}`),
};

export interface StatsDailyPoint {
  date: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
}
export interface StatsModelRow {
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
}
export interface StatsToolRow {
  name: string;
  uses: number;
}
export interface StatsTotals {
  days: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
  messages: number;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toLocaleString();
}

/** Prefer summary over first prompt as the human-friendly title. */
export function sessionTitle(s: { summary: string | null; firstPrompt: string | null; sessionId: string }): string {
  return (s.summary && s.summary.trim()) || (s.firstPrompt && s.firstPrompt.trim()) || s.sessionId.slice(0, 8);
}
