import { useTheme } from "../hooks/useTheme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle theme"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-rule text-ink2 hover:text-clay hover:border-clay transition-colors text-[11px] font-mono"
    >
      <span>{isDark ? "☾" : "☼"}</span>
      <span>{isDark ? "dark" : "light"}</span>
    </button>
  );
}
