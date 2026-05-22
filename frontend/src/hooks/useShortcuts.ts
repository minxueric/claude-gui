import { useEffect } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

interface ShortcutEntry {
  combo: string; // e.g. "mod+k", "shift+tab", "?"
  handler: ShortcutHandler;
  /** When true, fires even when an input/textarea/contentEditable is focused. */
  allowInInput?: boolean;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const wantMod = parts.includes("mod") || parts.includes("cmd") || parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt") || parts.includes("option");
  const key = parts[parts.length - 1];
  const hasMod = e.metaKey || e.ctrlKey;
  if (wantMod && !hasMod) return false;
  if (!wantMod && hasMod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  const k = (e.key || "").toLowerCase();
  if (key === "?") return k === "?" || (e.shiftKey && k === "/");
  if (key === "esc") return k === "escape";
  return k === key;
}

export function useShortcuts(entries: ShortcutEntry[], deps: any[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = isEditableTarget(e.target);
      for (const entry of entries) {
        if (inField && !entry.allowInInput) continue;
        if (matches(e, entry.combo)) {
          const handled = entry.handler(e);
          if (handled !== false) {
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
