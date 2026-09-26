"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AGENT_PROFILES, type AgentProfile } from "@/lib/agents";
import { ENS_PARENT } from "@/lib/config";
import { ago, usdc } from "@/lib/format";
import { quote, TIER_NAMES } from "@/lib/pricing";
import { PageHead, Pill } from "@/components/ui";
import { PoweredBy } from "@/components/PoweredBy";

/** Browse agent profiles, pick one to insure; below, the agents actually insured on this network. */
export default function AgentsPage() {
  const live = useQuery({ queryKey: ["policies", "all"], queryFn: () => api.policies(), refetchInterval: 20_000, retry: 0 });

  return (
    <main className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(48px, 9vw, 100px) 24px 100px" }}>
      <PageHead label="agents" title="What does your agent do?">
        Surety insures agents you already run. Pick the profile closest to its job: we pre-fill rules that bound its worst
        case, and price the cover from them.
      </PageHead>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))", gap: 16, marginTop: 28 }}>
        {AGENT_PROFILES.map((p) => (
          <ProfileCard key={p.key} p={p} live={p.key === "payments"} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 56, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 26 }}>Insured on Surety</h2>
        <span className="label">live from the chain · every name resolves through ENS</span>
      </div>
      <div style={{ marginTop: 10, borderTop: "1px solid var(--line)" }}>
        {live.isLoading && <div className="label flick" style={{ padding: "18px 0" }}>loading…</div>}
        {live.isError && <div className="label" style={{ padding: "18px 0", color: "var(--loss)" }}>{(live.error as Error).message}</div>}
        {live.data?.length === 0 && <div className="label" style={{ padding: "18px 0" }}>no agents insured on this network yet.</div>}
        {live.data?.map((s) => {
          const name = s.label ? `${s.label}.${ENS_PARENT}` : s.node.slice(0, 12) + "…";
          const exhausted = BigInt(s.policy.paidOut) >= BigInt(s.policy.coverageLimit);
          return (
            <Link
              key={s.node}
              href={`/policy/${s.label ?? s.node}`}
              className="wl-row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.4fr) repeat(3, minmax(0, 1fr)) auto",
                gap: 14,
                alignItems: "center",
                padding: "14px 6px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
              <span className="tnum" style={{ color: "var(--muted)" }}>
                {usdc(s.policy.coverageLimit, 0)} USDC cover
              </span>
              <span className="tnum" style={{ color: "var(--muted)" }}>
                cap {usdc(s.policy.perTxCap, 0)}
              </span>
              <span className="tnum" style={{ color: "var(--muted)" }}>
                {s.claims.length} claim{s.claims.length === 1 ? "" : "s"}
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
                <Pill tone={!s.policy.active ? "loss" : exhausted ? "muted" : "gain"}>{!s.policy.active ? "inactive" : exhausted ? "exhausted" : "active"}</Pill>
                <span className="label">{ago(s.issuedAt)}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

function ProfileCard({ p, live }: { p: AgentProfile; live: boolean }) {
  const premium = quote({ coverage: p.coverage, tier: p.tier, streak: 0, claims: 0, periods: 0 }).premium;
  return (
    <article className="side-card" style={{ padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <h3 style={{ fontSize: 20 }}>{p.name}</h3>
        {p.swaps && <PoweredBy sponsor="uniswap" label="swaps via" />}
      </div>
      <p style={{ fontSize: 14, color: "var(--ink)", margin: 0 }}>{p.tagline}</p>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{p.does}</p>

      <div>
        <div className="label" style={{ marginBottom: 6 }}>
          what goes wrong
        </div>
        <ul style={{ fontSize: 13, color: "var(--muted)", paddingLeft: 16, listStyle: "square", margin: 0 }}>
          {p.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div
        className="tnum"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          fontSize: 12,
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
          padding: "10px 0",
        }}
      >
        <span>
          <span className="label" style={{ display: "block" }}>
            cover
          </span>
          {p.coverage.toLocaleString("en-US")} USDC
        </span>
        <span>
          <span className="label" style={{ display: "block" }}>
            per-tx cap
          </span>
          {p.cap.toLocaleString("en-US")} USDC
        </span>
        <span>
          <span className="label" style={{ display: "block" }}>
            tier
          </span>
          {p.tier} · {TIER_NAMES[p.tier].toLowerCase()}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--faint)" }}>allowlist: {p.allowlistHint}</div>

      <div style={{ marginTop: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/insure?type=${p.key}`} className="btn btn-signal">
          Insure · {premium.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
        </Link>
        {live && (
          <Link href="/agents/payments" className="btn">
            <span style={{ color: "var(--gain)" }}>●</span> Run it live →
          </Link>
        )}
      </div>
    </article>
  );
}
