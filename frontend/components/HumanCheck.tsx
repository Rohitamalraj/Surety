"use client";

import { useCallback, useEffect, useState } from "react";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { api, type IdkitConfig } from "@/lib/api";
import { TxLink } from "./ui";

/**
 * IDKit proof of unique human before buying (PRD §11.2). The proof's signal is the lowercase
 * wallet address; the backend verifies it with the Developer Portal and records the nullifier
 * on-chain in WorldIdGate — one human, one policy wallet.
 */
export function HumanCheck({ address, onVerified }: { address: string; onVerified: (v: boolean) => void }) {
  const [cfg, setCfg] = useState<IdkitConfig | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.idkitStatus(address);
      setVerified(s.verified);
      onVerified(s.verified);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [address, onVerified]);

  useEffect(() => {
    api.idkitConfig().then(setCfg).catch((e) => setErr((e as Error).message));
    void refresh();
  }, [refresh]);

  async function start() {
    if (!cfg) return;
    setErr(null);
    setBusy(true);
    try {
      if (cfg.devMode) {
        const r = await api.idkitDevVerify(address);
        setTx(r.txHash ?? null);
        await refresh();
        return;
      }
      const s = await api.idkitRpSignature();
      setRp({ rp_id: cfg.rp_id!, nonce: s.nonce, created_at: s.created_at, expires_at: s.expires_at, signature: s.sig });
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(result: IDKitResult) {
    const r = await api.idkitVerify(address, result);
    if (!r.verified) throw new Error(r.error ?? "verification failed");
    setTx(r.txHash ?? null);
  }

  if (verified) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
        <span className="pill pill-gain">
          <span className="pill-dot" />
          unique human
        </span>
        <span style={{ color: "var(--muted)" }}>This wallet is bound to one verified person.</span>
        <TxLink hash={tx} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: "58ch" }}>
        Prove you&apos;re a unique human with World ID. The proof is bound to this wallet, and a person can back only one
        policy wallet, so nobody can farm the shared pool with a hundred accounts. No personal data is shared.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={!cfg || busy || (!cfg.enabled && !cfg.devMode)} onClick={() => void start()}>
          ◎ {busy ? "working…" : cfg?.devMode ? "Mark unique human (local dev)" : "Prove you're human"}
        </button>
        {cfg && !cfg.enabled && !cfg.devMode && <span className="label">IDKit not configured on the backend</span>}
        {cfg?.devMode && <span className="label">local devnet · no World App needed</span>}
      </div>
      {err && (
        <div className="label" style={{ color: "var(--loss)", textTransform: "none", letterSpacing: 0 }}>
          {err}
        </div>
      )}
      {cfg?.enabled && rp && cfg.app_id && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={cfg.app_id}
          action={cfg.action}
          rp_context={rp}
          environment={cfg.environment}
          allow_legacy_proofs={true}
          preset={proofOfHuman({ signal: address.toLowerCase() })}
          handleVerify={handleVerify}
          onSuccess={() => void refresh()}
          onError={(code) => setErr(`World ID: ${code}`)}
        />
      )}
    </div>
  );
}
