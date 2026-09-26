"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, hookAbi } from "@/lib/abi";
import { useDeployments, useFeed } from "@/lib/hooks";
import { toUnits } from "@/lib/format";
import { DitherArt } from "@/components/DitherArt";
import { EventRow } from "@/components/EventRow";
import { SolvencyBar } from "@/components/SolvencyBar";
import { PageHead } from "@/components/ui";

type Filter = "all" | "claims" | "money" | "policies";
const FILTERS: { key: Filter; label: string; types: string[] | null }[] = [
  { key: "all", label: "Everything", types: null },
  { key: "claims", label: "Claims", types: ["ClaimFiled", "ClaimHeld", "ClaimApproved", "ClaimPaid", "ClaimRejected"] },
  { key: "money", label: "Reserve", types: ["PremiumDeposited", "BackingDeposited", "PayoutReleased"] },
  { key: "policies", label: "Policies", types: ["PolicyIssued", "StreakUpdated", "PolicyExhausted", "HumanVerified"] },
];

/** The public audit trail + solvency (PRD §17.2 /feed). Every row is an on-chain event. */
export default function FeedPage() {
  const feed = useFeed();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const types = FILTERS.find((f) => f.key === filter)?.types;
    return (feed.data ?? []).filter((e) => !types || types.includes(e.type));
  }, [feed.data, filter]);

  return (
    <main className="mx-auto max-w-5xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      <PageHead label="// public audit trail" title="Everything, on the record.">
        Every purchase, payment, violation, claim, hold and payout is a public event. Nothing here needs special access; open any
        row on a block explorer.
      </PageHead>

      <div className="split" style={{ marginTop: 28 }}>
        <section style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {FILTERS.map((f) => {
              const on = f.key === filter;
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} className={`filter-pill ${on ? "filter-on" : ""}`}>
                  {f.label}
                </button>
              );
            })}
          </div>
          {feed.isLoading && <div className="label flick" style={{ padding: "32px 0" }}>reading the chain…</div>}
          {feed.isError && <div className="label" style={{ padding: "32px 0", color: "var(--loss)" }}>backend offline — start it with npm run dev:local</div>}
          {feed.data && shown.length === 0 && <div className="label" style={{ padding: "32px 0", color: "var(--muted)" }}>nothing here yet.</div>}
          {shown.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </section>

        <aside style={{ minWidth: 0 }}>
          <div className="sticky-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="side-card">
              <div className="label" style={{ marginBottom: 12 }}>
                {"// solvency · reserve vs 2× coverage"}
              </div>
              <SolvencyBar />
            </div>
            <div style={{ position: "relative", height: 120, background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              <DitherArt shape="field" invert gap={4} className="h-full w-full" />
              <div className="label" style={{ position: "absolute", bottom: 12, left: 16, right: 16, color: "var(--dark-ink)", opacity: 0.8 }}>
                payouts come only from the liquid reserve
              </div>
            </div>
            <BackThePool />
          </div>
        </aside>
      </div>
    </main>
  );
}

/** Backers supply the reserve that makes the 2× invariant hold (premiums alone never reach it). */
function BackThePool() {
  const { address, isConnected } = useConnection();
  const d = useDeployments();
  const client = usePublicClient();
  const write = useWriteContract();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("1000");
  const [msg, setMsg] = useState<string | null>(null);
  const usdcAddr = d.data?.MockUSDC;
  const hook = d.data?.SuretyHook;

  async function back() {
    if (!usdcAddr || !hook || !client || !address) return;
    setMsg(null);
    try {
      const value = toUnits(amount);
      const h1 = await write.mutateAsync({ address: usdcAddr, abi: erc20Abi, functionName: "approve", args: [hook, value] });
      await client.waitForTransactionReceipt({ hash: h1 });
      const h2 = await write.mutateAsync({ address: hook, abi: hookAbi, functionName: "depositBacking", args: [value] });
      await client.waitForTransactionReceipt({ hash: h2 });
      setMsg("reserve funded ✓");
      void qc.invalidateQueries({ queryKey: ["solvency"] });
    } catch (e) {
      setMsg((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    }
  }

  return (
    <div className="side-card">
      <div className="label" style={{ marginBottom: 10 }}>
        {"// back the pool"}
      </div>
      {!usdcAddr ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Backing uses MockUSDC, which isn&apos;t deployed on this network yet.</div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          <button className="btn btn-primary" disabled={!isConnected || write.isPending} onClick={() => void back()}>
            {write.isPending ? "…" : "Deposit"}
          </button>
        </div>
      )}
      {msg && <div className="label" style={{ marginTop: 8, textTransform: "none", letterSpacing: 0 }}>{msg}</div>}
    </div>
  );
}
