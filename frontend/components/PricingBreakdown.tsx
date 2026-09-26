"use client";

import { quote, TIER_LOAD, TIER_NAMES, K, LAMBDA_PRIOR, type QuoteInput } from "@/lib/pricing";
import { pct } from "@/lib/format";

/**
 * The most important UI element for the demo (Setup Guide §6): the premium computed term by term
 * on screen, so a judge watching λ move believes the pricing is real. Same math as PricingEngine.sol.
 */
export function PricingBreakdown(input: QuoteInput) {
  const q = quote(input);
  const n = input.periods;
  const money = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows: [string, string, string][] = [
    ["Z", `n / (n + k) = ${n} / (${n} + ${K})`, q.z.toFixed(3)],
    ["λ_agent", `claims / max(n, 1) = ${input.claims} / ${Math.max(n, 1)}`, pct(q.lambdaAgent)],
    ["λ_post", `Z·λ_agent + (1 − Z)·${pct(LAMBDA_PRIOR, 0)}`, pct(q.lambdaPost)],
    ["tier load", `tier ${input.tier} · ${TIER_NAMES[input.tier].toLowerCase()}`, `×${TIER_LOAD[input.tier].toFixed(2)}`],
    ["streak", `min(${input.streak} × 1%, 20%)`, `−${pct(q.streakDisc, 0)}`],
  ];

  return (
    <div className="formula">
      <div className="label" style={{ marginBottom: 6 }}>
        {"premium, computed live"}
      </div>
      {rows.map(([sym, expr, val]) => (
        <div key={sym} className="formula-row">
          <span className="sym">{sym}</span>
          <span className="expr">{expr}</span>
          <span className="val num-in" key={val}>
            {val}
          </span>
        </div>
      ))}
      <div className="formula-row" style={{ borderBottom: 0 }}>
        <span className="sym">premium</span>
        <span className="expr">coverage × λ_post × load × (1 − streak)</span>
        <span />
      </div>
      <div className="formula-total">
        <span className="label" style={{ color: "var(--ink)" }}>
          {money(input.coverage)} × {pct(q.lambdaPost)} × {TIER_LOAD[input.tier].toFixed(2)} × {(1 - q.streakDisc).toFixed(2)}
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30 }} className="tnum num-in" key={q.premium}>
          {money(q.premium)} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>USDC</span>
        </span>
      </div>
    </div>
  );
}
