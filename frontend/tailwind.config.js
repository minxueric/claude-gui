/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Primary light palette ──────────────────────────────────
        paper:    "#FFFFFF",
        canvas:   "#F8F9FA",
        ink:      "#111827",
        ink2:     "#374151",
        muted:    "#9CA3AF",
        rule:     "#E5E7EB",
        rule2:    "#D1D5DB",

        // ── Accent (Claude orange) ─────────────────────────────────
        clay:     "#F97316",   // orange-500
        clayDeep: "#EA580C",   // orange-600
        clayWash: "#FFF7ED",   // orange-50

        // ── Semantic ───────────────────────────────────────────────
        moss:     "#16A34A",   // green-600
        amber2:   "#D97706",   // amber-600
        rust:     "#DC2626",   // red-600
      },
      fontFamily: {
        display: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.02em",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
        lift: "0 2px 8px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.10)",
      },
      keyframes: {
        rise: {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fade: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
      },
      animation: {
        rise: "rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        fade: "fade 300ms ease-out both",
      },
    },
  },
  plugins: [],
};
