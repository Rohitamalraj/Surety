"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, routerAbi, vaultAbi } from "@/lib/abi";
import { fullName, nodeFor, readPolicyRecords, RECORD_KEYS } from "@/lib/ens";
import { EnsVerify } from "@/components/EnsVerify";
import { useDeployments, useFeed, usePolicy } from "@/lib/hooks";
import { short, toUnits, usdc } from "@/lib/format";
import { TIER_NAMES } from "@/lib/pricing";
import { ClaimFlow } from "@/components/ClaimFlow";
import { EventRow } from "@/components/EventRow";
import { PageHead, Pill, Stat, TxLink, VIOLATION_TEXT } from "@/components/ui";
import { PoweredBy } from "@/components/PoweredBy";

function PolicyInner({ agentName }: { agentName: string }) {
  const decoded = decodeURIComponent(agentName);
  const node = useMemo(() => {
    try {
      return nodeFor(decoded);
    } catch {
      return undefined;
    }
  }, [decoded]);
  const isNode = /^0x[0-9a-fA-F]{64}$/.test(decoded);
  const wid = useSearchParams().get("wid");

  const policy = usePolicy(node);
  const feed = useFeed(node);
  const deployments = useDeployments();
  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["policy"] });
    void qc.invalidateQueries({ queryKey: ["feed"] });
  }, [qc]);

  const p = policy.data?.policy;
  const label = policy.data?.label ?? (isNode ? undefined : decoded);
  const title = label ? fullName(label) : short(node, 10, 8);

  if (policy.isError) {
    return (
      <main className="mx-auto max-w-5xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
        <PageHead label="policy" title={title}>
          No Surety policy found for this name. {String((policy.error as Error)?.message ?? "")}
        </PageHead>
      </main>
    );
  }

  const claimedPayments = new Set(policy.data?.claims.map((c) => c.paymentId));

  return (
    <main className="mx-auto px-6" style={{ maxWidth: 1180, padding: "clamp(48px, 9vw, 100px) 24px 100px" }}>
      <PageHead label="policy" title={<span style={{ overflowWrap: "anywhere" }}>{title}</span>}>
        {p ? (
          <>
            Policyholder {short(p.policyholder)} · agent {short(p.agent)} · payouts only to {short(p.payoutAddr)}, fixed at purchase.
          </>
        ) : (
          "reading the policy…"
        )}
      </PageHead>

      {p && (
        <div className="grid-2" style={{ marginTop: 24 }}>
          <Stat label="coverage" value={<>{usdc(p.coverageLimit, 0)}</>} sub="USDC limit" />
          <Stat label="per-tx cap" value={usdc(p.perTxCap, 0)} sub="published rule" />
          <Stat label="paid out" value={usdc(p.paidOut, 0)} sub={`${p.claimsCount} claim${p.claimsCount === 1 ? "" : "s"}`} />
          <Stat label="tier · streak" value={`${p.tier} · ${p.streak}`} sub={TIER_NAMES[p.tier as 0 | 1 | 2]?.toLowerCase()} />
        </div>
      )}

      <div className="split" style={{ marginTop: 28 }}>
        {/* ---- payments + claims ---- */}
        <section style={{ minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            {"claims"}
          </div>
          {policy.data?.claims.length === 0 && <div className="label" style={{ padding: "8px 0 16px", color: "var(--muted)" }}>no claims filed.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {policy.data?.claims
              .slice()
              .reverse()
              .map((c) => (
                <ClaimFlow
                  key={c.claimId}
                  claimId={c.claimId}
                  status={c.status}
                  amount={c.amount}
                  returnTo={`/policy/${node}`}
                  sessionId={wid}
                  onChange={refresh}
                />
              ))}
          </div>

          <div className="label" style={{ marginTop: 32, marginBottom: 8 }}>
            {"agent payments · every transfer is recorded"}
          </div>
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>#</th>
                  <th>to</th>
                  <th style={{ textAlign: "right" }}>amount</th>
                  <th>check</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(policy.data?.payments ?? [])
                  .slice()
                  .reverse()
                  .map((pay) => (
                    <tr key={pay.paymentId}>
                      <td className="tnum">{pay.paymentId}</td>
                      <td className="tnum">{short(pay.to)}</td>
                      <td className="tnum" style={{ textAlign: "right" }}>
                        {usdc(pay.amount)}
                      </td>
                      <td>
                        <Pill tone={pay.violation === "None" ? "gain" : "loss"}>{VIOLATION_TEXT[pay.violation]}</Pill>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {pay.violation !== "None" && !claimedPayments.has(pay.paymentId) && p?.active ? (
                          <FileClaim node={node!} paymentId={pay.paymentId} policyholder={p.policyholder} router={deployments.data?.ClaimRouter} onFiled={refresh} />
                        ) : (
                          <TxLink hash={pay.txHash} />
                        )}
                      </td>
                    </tr>
                  ))}
                {policy.data?.payments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="label" style={{ padding: 16 }}>
                      no payments yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- ENS record + audit trail ---- */}
        <aside style={{ minWidth: 0 }}>
          <div className="sticky-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {node && <FundAgent node={node} />}
            <EnsCard name={label} />
            {label && (
              <div className="side-card">
                <EnsVerify label={label} lookup={false} />
              </div>
            )}
            <div className="side-card" style={{ paddingBottom: 6 }}>
              <div className="label" style={{ marginBottom: 4 }}>
                {"audit trail · public events"}
              </div>
              {(feed.data ?? []).slice(0, 10).map((e) => (
                <EventRow key={e.id} e={e} showNode={false} />
              ))}
              {feed.data?.length === 0 && <div className="label">no events yet</div>}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/** The agent spends from its vault balance; anyone (usually the policyholder) can top it up. */
function FundAgent({ node }: { node: `0x${string}` }) {
  const { address, isConnected } = useConnection();
  const d = useDeployments();
  const client = usePublicClient();
  const write = useWriteContract();
  const [amount, setAmount] = useState("50");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const vault = d.data?.AgentVault;
  const token = d.data?.MockUSDC;

  const refresh = useCallback(async () => {
    if (!client || !vault) return;
    try {
      setBalance(await client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [node] }));
    } catch {
      setBalance(null);
    }
  }, [client, vault, node]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function fund() {
    if (!client || !vault || !token || !address) return;
    setMsg(null);
    try {
      const value = toUnits(amount);
      const have = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] });
      if (have < value) {
        setMsg("minting Sepolia test USDC…");
        const m = await write.mutateAsync({ address: token, abi: erc20Abi, functionName: "mint", args: [address, value - have] });
        await client.waitForTransactionReceipt({ hash: m });
      }
      setMsg("approving…");
      const a = await write.mutateAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, value] });
      await client.waitForTransactionReceipt({ hash: a });
      setMsg("depositing…");
      const h = await write.mutateAsync({ address: vault, abi: vaultAbi, functionName: "deposit", args: [node, value] });
      await client.waitForTransactionReceipt({ hash: h });
      setMsg("agent funded ✓");
      void refresh();
    } catch (e) {
      setMsg((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    }
  }

  return (
    <div className="side-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span className="label">agent spending balance</span>
        <span className="tnum" style={{ fontSize: 14 }}>{balance === null ? "—" : `${usdc(balance)} USDC`}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="field-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <button className="btn btn-primary" disabled={!isConnected || write.isPending || !vault} onClick={() => void fund()}>
          {write.isPending ? "…" : "Fund agent"}
        </button>
      </div>
      {msg && <div className="label" style={{ marginTop: 8, textTransform: "none", letterSpacing: 0 }}>{msg}</div>}
    </div>
  );
}

/** Live ENS text records — the rules as published (resolver resolved fresh each read). */
function EnsCard({ name }: { name?: string }) {
  const client = usePublicClient();
  const [records, setRecords] = useState<Record<string, string> | null | undefined>(undefined);
  useEffect(() => {
    if (!client || !name) {
      setRecords(null);
      return;
    }
    let stop = false;
    void readPolicyRecords(client, name).then((r) => !stop && setRecords(r));
    return () => {
      stop = true;
    };
  }, [client, name]);

  return (
    <div className="side-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="label">{"ens records"}</span>
        <PoweredBy sponsor="ens" label={null} />
      </div>
      {records === undefined && <div className="label flick">resolving…</div>}
      {records === null && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          ENS records aren&apos;t readable on this network (the local devnet has no ENS). On Sepolia this card reads{" "}
          {RECORD_KEYS.length} <code>surety.*</code> text records straight from the policy&apos;s ENSv2 resolver.
        </div>
      )}
      {records &&
        RECORD_KEYS.map((k) => (
          <div key={k} className="kv">
            <span>{k.replace("surety.", "")}</span>
            <span className="tnum">
              {!records[k]
                ? "—"
                : ["surety.coverageLimit", "surety.perTxCap", "surety.premium"].includes(k) && /^d+$/.test(records[k])
                  ? `${usdc(records[k])} USDC`
                  : records[k]}
            </span>
          </div>
        ))}
    </div>
  );
}

function FileClaim({
  node,
  paymentId,
  policyholder,
  router,
  onFiled,
}: {
  node: `0x${string}`;
  paymentId: string;
  policyholder: string;
  router?: `0x${string}`;
  onFiled: () => void;
}) {
  const { address } = useConnection();
  const write = useWriteContract();
  const client = usePublicClient();
  const [err, setErr] = useState<string | null>(null);
  const isHolder = address?.toLowerCase() === policyholder.toLowerCase();

  async function file() {
    if (!router || !client) return;
    setErr(null);
    try {
      const hash = await write.mutateAsync({ address: router, abi: routerAbi, functionName: "fileClaim", args: [node, BigInt(paymentId)] });
      await client.waitForTransactionReceipt({ hash });
      onFiled();
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        className="btn btn-danger"
        style={{ padding: "6px 10px" }}
        disabled={!isHolder || write.isPending}
        title={isHolder ? "file a claim for this violation" : "connect the policyholder wallet to file"}
        onClick={() => void file()}
      >
        {write.isPending ? "filing…" : "File claim"}
      </button>
      {!isHolder && <span className="label" style={{ fontSize: 9 }}>policyholder only</span>}
      {err && <span className="label" style={{ color: "var(--loss)", textTransform: "none", letterSpacing: 0, maxWidth: 220 }}>{err}</span>}
    </span>
  );
}

export default function PolicyPage({ params }: { params: Promise<{ agentName: string }> }) {
  const { agentName } = use(params);
  return (
    <Suspense fallback={<div className="label flick" style={{ padding: 80 }}>loading policy…</div>}>
      <PolicyInner agentName={agentName} />
    </Suspense>
  );
}
