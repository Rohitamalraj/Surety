"use client";

import { useSolvency } from "@/lib/hooks";
import { usdc } from "@/lib/format";

/** Liquid reserve vs the 2× outstanding-coverage invariant (PRD §18.1 #2). */
export function SolvencyBar({ compact = false }: { compact?: boolean }) {
  const { data, isError } = useSolvency();
  if (isError) return <div className="label">solvency unavailable — backend offline</div>;
  if (!data) return <div className="label flick">reading the reserve…</div>;

  const reserve = Number(BigInt(data.liquidReserve)) / 1e6;
  const coverage = Number(BigInt(data.totalCoverage)) / 1e6;
  const required = coverage * data.required;
  // scale so the 2× line sits at 50% when coverage exists; otherwise reserve fills the bar
  const scale = Math.max(required * 2, reserve, 1);
  const fill = Math.min(100, (reserve / scale) * 100);
  const mark = required > 0 ? (required / scale) * 100 : null;
  const healthy = reserve >= required;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <span className="label">liquid reserve</span>
        <span className="tnum" style={{ fontSize: compact ? 13 : 15, color: "var(--ink)" }}>
          {usdc(data.liquidReserve)} <span style={{ color: "var(--faint)", fontSize: 11 }}>USDC</span>
        </span>
      </div>
      <div className="solv-track">
        <div className={`solv-fill ${healthy ? "solv-fill-ok" : "solv-fill-bad"}`} style={{ width: `${fill}%` }} />
        {mark !== null && <div className="solv-mark" style={{ left: `${mark}%` }} title="2× outstanding coverage" />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, fontSize: 11 }}>
        <span style={{ color: "var(--faint)" }}>
          coverage out <span className="tnum" style={{ color: "var(--muted)" }}>{usdc(data.totalCoverage, 0)}</span>
        </span>
        <span style={{ color: healthy ? "var(--gain)" : "var(--loss)" }} className="tnum">
          {data.ratio === null ? "no coverage outstanding" : `${data.ratio.toFixed(2)}× · needs ≥ ${data.required}×`}
        </span>
      </div>
    </div>
  );
}
