"use client";

import { setTheme, useTheme } from "@/lib/theme";

/** Light / dark switch: a two-segment pill with sun and moon glyphs. */
export function ThemeToggle() {
  const theme = useTheme();
  const seg = (on: boolean): React.CSSProperties => ({
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 26,
    border: 0,
    borderRadius: 999,
    cursor: "pointer",
    background: on ? "var(--signal)" : "transparent",
    color: on ? "var(--surface)" : "var(--muted)",
    transition: "background .2s, color .2s",
  });

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      style={{ display: "inline-flex", gap: 2, padding: 2, border: "1px solid var(--line-strong)", borderRadius: 999, background: "var(--surface)" }}
    >
      <button role="radio" aria-checked={theme === "light"} title="Light mode" style={seg(theme === "light")} onClick={() => setTheme("light")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
      <button role="radio" aria-checked={theme === "dark"} title="Dark mode" style={seg(theme === "dark")} onClick={() => setTheme("dark")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      </button>
    </div>
  );
}
