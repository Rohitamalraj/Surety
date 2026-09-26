/** SURETY, with SURE highlighted — the same move as the reference's KOL-in-KOLlateral. */
export function Wordmark({ size = 22, caret = false }: { size?: number; caret?: boolean }) {
  return (
    <span className="pixel" style={{ fontSize: size, letterSpacing: "0.04em", color: "var(--ink)" }}>
      <span className="sure">SURE</span>TY
      {caret && <span className="flick">_</span>}
    </span>
  );
}
