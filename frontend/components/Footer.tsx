import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer
      className="mx-auto max-w-6xl px-6"
      style={{
        padding: "28px 24px 48px",
        borderTop: "1px solid var(--line)",
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      <span style={{ opacity: 0.7 }}>
        <Wordmark size={16} />
      </span>
      <span className="label">the rules are public · the payout is a contract call · ethglobal tokyo 2026</span>
    </footer>
  );
}
