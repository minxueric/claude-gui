import { useQuery } from "@tanstack/react-query";
import { api, SlashCommand } from "../lib/api";

export function useSlashCommands(cwd?: string) {
  return useQuery({
    queryKey: ["slash-commands", cwd ?? ""],
    queryFn: () => api.commands(cwd),
    staleTime: 30_000,
  });
}

export function filterCommands(all: SlashCommand[] | undefined, query: string): SlashCommand[] {
  if (!all) return [];
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, 30);
  return all
    .map((c) => {
      const name = c.name.toLowerCase();
      let score = 0;
      if (name === q) score += 200;
      if (name.startsWith(q)) score += 80;
      if (name.includes(q)) score += 50;
      if ((c.description || "").toLowerCase().includes(q)) score += 20;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((x) => x.c);
}
