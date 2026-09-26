"use client";

import { useEffect, useRef, useState } from "react";
import { api, worldIdStartUrl, type ClaimStatus, type WorldIdSession } from "@/lib/api";
import { usdc } from "@/lib/format";
import { Pill, TxLink } from "./ui";

/**
 * The claim checkpoint (PRD §11.1 B / §8.4). A payout needs a *fresh* World ID for Agents check by the
 * same human who bought the policy — validated server-side. Cancel/deny/mismatch holds the claim on-chain.
 *
 * `sessionId` is set when the page was reached back from World ID (?wid=…).
 */
export function ClaimFlow({
  claimId,
  status,
  amount,
  returnTo,
  sessionId,
  onChange,
}: {
  claimId: string;
  status: ClaimStatus;
  amount?: string;
  returnTo: string;
  sessionId?: string | null;
  onChange?: () => void;
}) {
  const [session, setSession] = useState<WorldIdSession | null>(null);
  const [payoutTx, setPayoutTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const executed = useRef(false);

  // Follow the World ID session this page returned with (only if it's for this claim).
  useEffect(() => {
    if (!sessionId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.session(sessionId);
        if (stop || s.claimId !== claimId) return;
        setSession(s);
        if (s.status === "pending") setTimeout(tick, 1200);
        else onChange?.();
      } catch (e) {
        if (!stop) setErr((e as Error).message);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [sessionId, claimId, onChange]);

  // Verified → release the payout once (one tx: WorldIdGate.approveClaim + ClaimRouter.execute).
  useEffect(() => {
    if (session?.status !== "approved" || executed.current || status === "Paid") return;
    const key = `surety.executed.${session.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    executed.current = true;
    setBusy(true);
    api
      .executeClaim(claimId, session.id)
      .then((r) => {
        setPayoutTx(r.txHash);
        onChange?.();
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  }, [session, claimId, status, onChange]);

  const verifyHref = worldIdStartUrl({ purpose: "claim", claimId, returnTo });
  const failed = session && ["cancelled", "denied", "expired", "mismatch"].includes(session.status);
  const held = status === "Held" || failed;
  const cls = status === "Paid" ? "claim-card claim-card-paid" : held ? "claim-card claim-card-held" : "claim-card";

  return (
    <div className={cls}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>
          Claim #{claimId}
          {amount && (
            <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 13, color: "var(--muted)", marginLeft: 10 }}>
              {usdc(amount)} USDC
            </span>
          )}
        </span>
        <StatusPill status={status} session={session} busy={busy} />
      </div>

      {status === "Paid" ? (
        <div style={{ fontSize: 13, color: "var(--gain)" }}>
          Paid from the Uniswap v4 hook&apos;s liquid reserve. <TxLink hash={payoutTx} label="payout" />
        </div>
      ) : status === "Rejected" ? (
        <div style={{ fontSize: 13, color: "var(--loss)" }}>Rejected by the anti-self-dealing checks. Nothing was paid.</div>
      ) : (
        <>
          {failed && (
            <div style={{ fontSize: 13, color: "var(--loss)" }}>
              Held, not paid: {session!.reason ?? session!.status}. <TxLink hash={session!.heldTx} label="hold" />
            </div>
          )}
          {!failed && session?.status === "approved" && (
            <div style={{ fontSize: 13, color: "var(--ink)" }}>
              Same human, fresh proof. {busy ? "Releasing the payout…" : payoutTx ? "Payout sent." : "Ready to release."}{" "}
              <TxLink hash={payoutTx} label="payout" />
            </div>
          )}
          {!session && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Payout needs a fresh World ID check by the human who bought this policy. The agent&apos;s key can&apos;t do this.
            </div>
          )}
          {session?.status !== "approved" && (
            <a href={verifyHref} className={`btn ${held ? "" : "btn-primary"}`} style={{ alignSelf: "flex-start" }}>
              ◎ {held ? "Verify again with World ID" : "Verify with World ID"}
            </a>
          )}
        </>
      )}
      {err && <div className="label" style={{ color: "var(--loss)", textTransform: "none", letterSpacing: 0 }}>{err}</div>}
    </div>
  );
}

function StatusPill({ status, session, busy }: { status: ClaimStatus; session: WorldIdSession | null; busy: boolean }) {
  if (status === "Paid") return <Pill tone="gain">paid</Pill>;
  if (status === "Rejected") return <Pill tone="loss">rejected</Pill>;
  if (busy) return <Pill tone="live">releasing</Pill>;
  if (session?.status === "pending") return <Pill tone="live">verifying</Pill>;
  if (session?.status === "approved") return <Pill tone="ink">verified</Pill>;
  if (status === "Held" || session) return <Pill tone="loss">held</Pill>;
  return <Pill tone="live">pending</Pill>;
}
