import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useCwdFileMatch(cwd: string | undefined, q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["files-match", cwd ?? "", q],
    queryFn: () => api.fileMatch(cwd!, q, 30),
    enabled: !!cwd && enabled,
    staleTime: 5_000,
  });
}

export function useFileTree(cwd: string | undefined, path: string = "") {
  return useQuery({
    queryKey: ["files-tree", cwd ?? "", path],
    queryFn: () => api.fileTree(cwd!, path),
    enabled: !!cwd,
    staleTime: 0,
    gcTime: 0,
    retry: 2,
    retryDelay: 500,
    refetchInterval: 3000,
  });
}
