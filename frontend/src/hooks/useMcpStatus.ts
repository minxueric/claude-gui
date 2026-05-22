import { useQuery } from "@tanstack/react-query";

export interface McpServerInfo {
  name: string;
  command?: string | null;
  args?: string[];
  url?: string | null;
  transport?: string | null;
}

export interface McpServersResponse {
  settingsFile: string;
  servers: McpServerInfo[];
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

export function useMcpServers() {
  return useQuery({
    queryKey: ["mcp", "servers"],
    queryFn: () => get<McpServersResponse>("/api/mcp/servers"),
    staleTime: 60_000,
  });
}

export function useMcpChatStatus(chatId: string | null) {
  return useQuery({
    queryKey: ["mcp", "chat", chatId],
    queryFn: () => get<{ status: any; available: boolean }>(`/api/mcp/status/${chatId}`),
    enabled: !!chatId,
    refetchInterval: 10_000,
  });
}
