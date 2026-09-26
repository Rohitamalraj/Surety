/** Surety wordmark: a blue shield tile with a check, then the name in the display face. */
export function Wordmark({ size = 20 }: { size?: number; caret?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-display), sans-serif",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.03em",
        color: "var(--ink)",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span className="sure" aria-hidden>
        ✓
      </span>
      surety
    </span>
  );
}
