import type { ReactNode } from "react";
import { short, txUrl } from "@/lib/format";

/** Section header grammar from the reference: // mono label, big display h1, muted lede. */
export function PageHead({ label, title, children }: { label: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 22 }}>
      <div className="label" style={{ marginBottom: 10 }}>
        {label}
      </div>
      <h1 style={{ fontSize: "clamp(32px, 6vw, 56px)" }}>{title}</h1>
      {children && <p style={{ marginTop: 10, color: "var(--muted)", fontSize: 14, maxWidth: "64ch" }}>{children}</p>}
    </div>
  );
}

export function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  if (!hash) return null;
  const url = txUrl(hash);
  const text = `${label ? `${label} ` : ""}${short(hash, 8, 6)}`;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="link tnum" style={{ fontSize: 11 }}>
      {text} ↗
    </a>
  ) : (
    <span className="tnum" style={{ fontSize: 11, color: "var(--faint)" }} title={hash}>
      {text}
    </span>
  );
}

export function Pill({ tone = "muted", children }: { tone?: "muted" | "gain" | "loss" | "live" | "ink"; children: ReactNode }) {
  const cls = tone === "muted" ? "pill" : `pill pill-${tone}`;
  return (
    <span className={cls}>
      <span className="pill-dot" />
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-v">{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export const VIOLATION_TEXT: Record<string, string> = {
  None: "within policy",
  CapBreach: "over per-tx cap",
  OffAllowlist: "off allowlist",
  Attested: "attested bad actor",
};
