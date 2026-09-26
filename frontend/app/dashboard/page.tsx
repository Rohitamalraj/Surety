"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useConnect, useConnection } from "wagmi";
import { api, type ClaimStatus, type PolicySummary } from "@/lib/api";
import { ENS_PARENT } from "@/lib/config";
import { ago, short, usdc } from "@/lib/format";
import { TIER_NAMES } from "@/lib/pricing";
import { PageHead, Pill, TxLink } from "@/components/ui";

const CLAIM_TONE: Record<ClaimStatus, "gain" | "loss" | "live" | "muted"> = {
  None: "muted",
  Pending: "live",
  Held: "loss",
  Paid: "gain",
  Rejected: "loss",
};

const sum = (xs: string[]) => xs.reduce((a, b) => a + BigInt(b), 0n);
const nameOf = (s: PolicySummary) => (s.label ? `${s.label}.${ENS_PARENT}` : short(s.node, 10, 6));
const hrefOf = (s: PolicySummary) => `/policy/${s.label ?? s.node}`;

/** Everything the connected wallet holds: its policies, what they cost, what they've paid, every claim. */
export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useConnection();
  const connect = useConnect();
  const mine = useQuery({
    queryKey: ["policies", address],
    queryFn: () => api.policies(address),
    enabled: !!address,
    refetchInterval: 15_000,
    retry: 0,
  });

  const list = mine.data ?? [];
  const claims = list.flatMap((s) => s.claims.map((c) => ({ ...c, policy: s })));
  const open = claims.filter((c) => c.status === "Pending" || c.status === "Held");

  return (
    <main className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(48px, 9vw, 100px) 24px 100px" }}>
      <PageHead label="my policies" title="Your insured agents">
        Every policy this wallet holds, read live from the chain: cover left, premiums paid, payouts received and each
        claim&apos;s status.
      </PageHead>

      {!mounted ? null : !isConnected ? (
        <div className="side-card" style={{ marginTop: 28, padding: 24, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>Connect the wallet you bought cover with.</span>
          <button className="btn btn-primary" onClick={() => connect.connectors[0] && connect.mutate({ connector: connect.connectors[0] })}>
            Connect wallet
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", gap: 12, marginTop: 28 }}>
            <Tile label="policies" value={String(list.length)} />
            <Tile label="total cover" value={`${usdc(sum(list.map((s) => s.policy.coverageLimit)), 0)} USDC`} />
            <Tile label="premiums paid" value={`${usdc(sum(list.map((s) => s.premium)))} USDC`} />
            <Tile label="paid out to you" value={`${usdc(sum(list.map((s) => s.policy.paidOut)))} USDC`} />
            <Tile label="open claims" value={String(open.length)} tone={open.length ? "live" : undefined} />
          </div>

          {mine.isLoading && <div className="label flick" style={{ padding: "24px 0" }}>loading your policies…</div>}
          {mine.isError && <div className="label" style={{ padding: "24px 0", color: "var(--loss)" }}>{(mine.error as Error).message}</div>}
          {mine.data?.length === 0 && (
            <div className="side-card" style={{ marginTop: 20, padding: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>No policies on {short(address)} yet.</span>
              <Link href="/agents" className="btn">
                Browse agents
              </Link>
              <Link href="/insure" className="btn btn-signal">
                Insure an agent →
              </Link>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 16, marginTop: 20 }}>
            {list.map((s) => (
              <PolicyCard key={s.node} s={s} />
            ))}
          </div>

          {claims.length > 0 && (
            <>
              <h2 style={{ fontSize: 24, marginTop: 48 }}>Claims</h2>
              <div style={{ marginTop: 10, borderTop: "1px solid var(--line)" }}>
                {claims
                  .sort((a, b) => b.filedAt - a.filedAt)
                  .map((c) => (
                    <Link
                      key={c.claimId}
                      href={hrefOf(c.policy)}
                      className="wl-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1.4fr) minmax(0, 1fr) auto auto",
                        gap: 14,
                        alignItems: "center",
                        padding: "14px 6px",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <span className="tnum" style={{ color: "var(--faint)" }}>
                        #{c.claimId}
                      </span>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {nameOf(c.policy)}
                      </span>
                      <span className="tnum" style={{ color: "var(--muted)" }}>
                        {usdc(c.amount)} USDC · payment #{c.paymentId}
                      </span>
                      <Pill tone={CLAIM_TONE[c.status]}>{c.status.toLowerCase()}</Pill>
                      <span className="label">{ago(c.filedAt)}</span>
                    </Link>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "live" }) {
  return (
    <div className="side-card" style={{ padding: "14px 16px" }}>
      <div className="label">{label}</div>
      <div className="tnum" style={{ fontSize: 20, marginTop: 6, color: tone === "live" ? "var(--signal)" : "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

function PolicyCard({ s }: { s: PolicySummary }) {
  const p = s.policy;
  const cover = BigInt(p.coverageLimit);
  const paid = BigInt(p.paidOut);
  const usedPct = cover === 0n ? 0 : Number((paid * 10_000n) / cover) / 100;
  const exhausted = paid >= cover;
  const open = s.claims.filter((c) => c.status === "Pending" || c.status === "Held").length;
  return (
    <article className="side-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h3 style={{ fontSize: 18, overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(s)}</h3>
        <Pill tone={!p.active ? "loss" : exhausted ? "muted" : "gain"}>{!p.active ? "inactive" : exhausted ? "exhausted" : "active"}</Pill>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }} className="tnum">
          <span style={{ color: "var(--muted)" }}>
            {usdc(cover - paid)} of {usdc(cover, 0)} USDC cover left
          </span>
          <span style={{ color: "var(--faint)" }}>{usedPct.toFixed(1)}% used</span>
        </div>
        <div style={{ height: 6, background: "var(--tint)", borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, usedPct)}%`, height: "100%", background: "var(--signal)" }} />
        </div>
      </div>

      <div className="tnum" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 14px", fontSize: 12 }}>
        <Row k="per-tx cap" v={`${usdc(p.perTxCap, 0)} USDC`} />
        <Row k="tier" v={`${p.tier} · ${TIER_NAMES[p.tier as 0 | 1 | 2].toLowerCase()}`} />
        <Row k="premium" v={`${usdc(s.premium)} USDC`} />
        <Row k="streak" v={String(p.streak)} />
        <Row k="agent" v={short(p.agent)} />
        <Row k="payments" v={String(s.payments)} />
        <Row k="claims" v={open ? `${s.claims.length} (${open} open)` : String(s.claims.length)} />
        <Row k="insured" v={ago(s.issuedAt)} />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginTop: 2 }}>
        <Link href={hrefOf(s)} className="btn btn-primary">
          Open · fund · claim →
        </Link>
        <TxLink hash={s.issuedTx} label="issued" />
      </div>
    </article>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--line)", padding: "3px 0" }}>
    <span className="label">{k}</span>
    <span>{v}</span>
  </span>
);
