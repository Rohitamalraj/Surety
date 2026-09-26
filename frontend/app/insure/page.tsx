"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isAddress, type Address, type Hex } from "viem";
import { useConnect, useConnection, usePublicClient, useWriteContract } from "wagmi";
import { api, worldIdStartUrl, type WorldIdSession } from "@/lib/api";
import { erc20Abi, registryAbi } from "@/lib/abi";
import { ENS_PARENT } from "@/lib/config";
import { short, toUnits } from "@/lib/format";
import { useDeployments } from "@/lib/hooks";
import { maxTier, quote, TIER_NAMES } from "@/lib/pricing";
import { nodeFor } from "@/lib/ens";
import { AGENT_PROFILES, profileByKey } from "@/lib/agents";
import { LineArt } from "@/components/LineArt";
import { HumanCheck } from "@/components/HumanCheck";
import { PricingBreakdown } from "@/components/PricingBreakdown";
import { PoweredBy } from "@/components/PoweredBy";
import { TxLink } from "@/components/ui";
import { TunnelHint } from "@/components/TunnelHint";

interface Form {
  label: string;
  agent: string;
  payout: string;
  coverage: string;
  cap: string;
  allowlist: string;
  tier: 0 | 1 | 2;
}
const EMPTY: Form = { label: "", agent: "", payout: "", coverage: "100", cap: "5", allowlist: "", tier: 2 };
const FORM_KEY = "surety.create.form";
const enrollKey = (a: string) => `surety.enroll.${a.toLowerCase()}`;

interface Enrollment {
  subHash: Hex;
  expiry: number;
  sig: Hex;
}

function InsureInner() {
  const params = useSearchParams();
  const wid = params.get("wid");
  const profile = profileByKey(params.get("type"));
  const { address, isConnected } = useConnection();
  const connect = useConnect();
  const client = usePublicClient();
  const write = useWriteContract();
  const deployments = useDeployments();

  const [form, setForm] = useState<Form>(EMPTY);
  const [human, setHuman] = useState(false);
  const [enroll, setEnroll] = useState<Enrollment | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "info"; text: string; tx?: string } | null>(null);
  const [issuedNode, setIssuedNode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Form survives the World ID round trip.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(FORM_KEY);
      if (saved) setForm({ ...EMPTY, ...(JSON.parse(saved) as Form) });
    } catch {}
  }, []);
  const update = (patch: Partial<Form> | ((f: Form) => Partial<Form>)) =>
    setForm((f) => {
      const next = { ...f, ...(typeof patch === "function" ? patch(f) : patch) };
      try {
        sessionStorage.setItem(FORM_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  // Coming from an agent profile (/insure?type=…): pre-fill its rules. Not on the World ID return trip,
  // where the saved form is what the user already chose.
  useEffect(() => {
    if (!profile || wid) return;
    update((f) => ({
      coverage: String(profile.coverage),
      cap: String(profile.cap),
      tier: profile.tier,
      label: f.label || `${profile.label}-${Math.random().toString(36).slice(2, 6)}`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.key, wid]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Restore / receive the World ID for Agents enrollment attestation.
  useEffect(() => {
    if (!address) return;
    try {
      const saved = sessionStorage.getItem(enrollKey(address));
      if (saved) setEnroll(JSON.parse(saved) as Enrollment);
    } catch {}
  }, [address]);

  useEffect(() => {
    if (!wid || !address) return;
    let stop = false;
    const tick = async () => {
      const s: WorldIdSession = await api.session(wid);
      if (stop || s.purpose !== "enroll") return;
      if (s.status === "pending") return void setTimeout(tick, 1200);
      if (s.status === "approved" && s.address?.toLowerCase() === address.toLowerCase() && s.subHash && s.sig && s.expiry) {
        const e = { subHash: s.subHash, expiry: s.expiry, sig: s.sig };
        setEnroll(e);
        setEnrollMsg(null);
        try {
          sessionStorage.setItem(enrollKey(address), JSON.stringify(e));
        } catch {}
      } else {
        setEnrollMsg(`World ID ${s.status}${s.reason ? ` · ${s.reason}` : ""}`);
      }
    };
    void tick().catch((e) => setEnrollMsg((e as Error).message));
    return () => {
      stop = true;
    };
  }, [wid, address]);

  // Rules → tier → live quote.
  const allow = useMemo(
    () =>
      form.allowlist
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [form.allowlist],
  );
  const coverage = Number(form.coverage) || 0;
  const cap = Number(form.cap) || 0;
  const best = maxTier(coverage, cap, allow.length);
  const tier = (Math.min(form.tier, best) as 0 | 1 | 2) ?? 0;
  const premium = quote({ coverage, tier, streak: 0, claims: 0, periods: 0 }).premium;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!/^[a-z0-9-]{1,32}$/.test(form.label)) p.push("name: lowercase letters, numbers, dashes");
    if (!isAddress(form.agent)) p.push("agent key must be an address");
    if (!isAddress(form.payout)) p.push("payout address must be an address");
    if (isAddress(form.agent) && isAddress(form.payout) && form.agent.toLowerCase() === form.payout.toLowerCase())
      p.push("payout can't be the agent key (it would be rejected as self-dealing)");
    if (allow.some((a) => !isAddress(a))) p.push("allowlist has an invalid address");
    if (isAddress(form.payout) && allow.some((a) => a.toLowerCase() === form.payout.toLowerCase()))
      p.push("payout address is on the allowlist — claims paying it would be rejected as self-dealing");
    if (coverage <= 0 || cap <= 0 || cap > coverage) p.push("cap must be positive and ≤ coverage");
    return p;
  }, [form, allow, coverage, cap]);

  const enrollValid = !!enroll && enroll.expiry > now + 20;

  const buy = useCallback(async () => {
    const d = deployments.data;
    if (!d?.PolicyRegistry || !client || !address || !enroll) return;
    setStatus(null);
    try {
      const registry = d.PolicyRegistry;
      if (d.MockUSDC) {
        const bal = await client.readContract({ address: d.MockUSDC, abi: erc20Abi, functionName: "balanceOf", args: [address] });
        const need = toUnits(premium.toFixed(6));
        if (bal < need) {
          setStatus({ tone: "info", text: "minting Sepolia test USDC for the premium…" });
          const h = await write.mutateAsync({ address: d.MockUSDC, abi: erc20Abi, functionName: "mint", args: [address, need * 2n] });
          await client.waitForTransactionReceipt({ hash: h });
        }
        setStatus({ tone: "info", text: "approving the premium…" });
        const h1 = await write.mutateAsync({ address: d.MockUSDC, abi: erc20Abi, functionName: "approve", args: [registry, need * 2n] });
        await client.waitForTransactionReceipt({ hash: h1 });
      }
      setStatus({ tone: "info", text: "issuing the policy and its ENS name…" });
      const hash = await write.mutateAsync({
        address: registry,
        abi: registryAbi,
        functionName: "issuePolicy",
        args: [
          {
            label: form.label,
            agent: form.agent as Address,
            payoutAddr: form.payout as Address,
            coverageLimit: toUnits(form.coverage),
            perTxCap: toUnits(form.cap),
            allowlist: allow as Address[],
            tier,
          },
          enroll.subHash,
          BigInt(enroll.expiry),
          enroll.sig,
        ],
      });
      await client.waitForTransactionReceipt({ hash });
      setIssuedNode(nodeFor(form.label));
      setStatus({ tone: "ok", text: `${form.label}.${ENS_PARENT} is insured.`, tx: hash });
    } catch (e) {
      setStatus({ tone: "bad", text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    }
  }, [deployments.data, client, address, enroll, premium, write, form, allow, tier]);

  const step = !isConnected ? 1 : !human ? 2 : !enrollValid ? 3 : issuedNode ? 6 : 4;
  const cls = (n: number) => `step ${step > n ? "step-done" : step === n ? "step-active" : ""}`;
  const input = (k: keyof Form, placeholder: string, hint?: string) => (
    <label className="field">
      <span className="label">{placeholder}</span>
      <input className="field-input" value={String(form[k])} onChange={(e) => update({ [k]: e.target.value } as Partial<Form>)} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );

  return (
    <main>
      {/* ---- hero band ---- */}
      <section className="relative overflow-hidden" style={{ borderBottom: "1px solid var(--line)" }}>
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 hidden md:block"
          style={{ width: "46%", background: "var(--tint)", borderLeft: "1px solid var(--line)" }}
        >
          <LineArt shape="signal" className="h-full w-full" />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-6" style={{ padding: "clamp(56px, 9vw, 110px) 24px clamp(40px, 6vw, 70px)" }}>
          <div className="label rise">{profile ? `insure · ${profile.name.toLowerCase()}` : "insure"}</div>
          <h1 className="rise" style={{ fontSize: "clamp(40px, 7.5vw, 92px)", marginTop: 14, lineHeight: 0.95, maxWidth: "14ch", animationDelay: "80ms" }}>
            Insure your agent.
          </h1>
          <p className="rise" style={{ marginTop: 18, color: "var(--muted)", maxWidth: "56ch", fontSize: 15, animationDelay: "160ms" }}>
            Publish its rules as an ENS name, prove you&apos;re the human behind it, and pay a premium computed in front of you.
          </p>
          <div className="rise" style={{ marginTop: 22, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", animationDelay: "220ms" }}>
            <span className="label" style={{ marginRight: 4 }}>
              start from
            </span>
            {AGENT_PROFILES.map((p) => (
              <Link key={p.key} href={`/insure?type=${p.key}`} className={`filter-pill ${profile?.key === p.key ? "filter-on" : ""}`}>
                {p.name.replace(" agent", "")}
              </Link>
            ))}
            <Link href="/agents" className="link label" style={{ marginLeft: 4 }}>
              compare profiles →
            </Link>
          </div>
          {profile && (
            <p className="rise" style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", maxWidth: "60ch" }}>
              Rules pre-filled for a {profile.name.toLowerCase()}. Put {profile.allowlistHint} on the allowlist, then adjust
              anything.
            </p>
          )}
        </div>
      </section>

      <div className="mx-auto px-6" style={{ maxWidth: 1180, padding: "40px 24px 100px" }}>
        <div className="split">
          {/* ---- steps ---- */}
          <section style={{ minWidth: 0 }}>
            <div className="steps">
              <div className={cls(1)}>
                <span className="step-n">{step > 1 ? "✓" : "1"}</span>
                <div>
                  <div className="step-title">Connect the policyholder wallet</div>
                  <div style={{ marginTop: 10 }}>
                    {isConnected ? (
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>
                        Connected as <span className="tnum" style={{ color: "var(--ink)" }}>{short(address)}</span>
                      </span>
                    ) : (
                      <button className="btn btn-primary" onClick={() => connect.connectors[0] && connect.mutate({ connector: connect.connectors[0] })}>
                        Connect wallet
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className={`${cls(2)} ${step < 2 ? "step-lock" : ""}`}>
                <span className="step-n">{step > 2 ? "✓" : "2"}</span>
                <div>
                  <div className="step-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    Prove you&apos;re a unique human <PoweredBy sponsor="world" label="IDKit" />
                  </div>
                  <div style={{ marginTop: 10 }}>{address && <HumanCheck address={address} onVerified={setHuman} />}</div>
                </div>
              </div>

              <div className={`${cls(3)} ${step < 3 ? "step-lock" : ""}`}>
                <span className="step-n">{step > 3 ? "✓" : "3"}</span>
                <div>
                  <div className="step-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    Enroll with World ID for Agents <PoweredBy sponsor="world" label="for agents" />
                  </div>
                  <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, maxWidth: "58ch" }}>
                    Binds this policy to you. At claim time, only a fresh World ID check by this same person can release a payout.
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <TunnelHint />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {enrollValid ? (
                      <span className="pill pill-gain">
                        <span className="pill-dot" />
                        enrolled · valid {Math.max(0, enroll!.expiry - now)}s
                      </span>
                    ) : (
                      address && (
                        <a className="btn btn-primary" href={worldIdStartUrl({ purpose: "enroll", address, returnTo: "/insure" })}>
                          ◎ {enroll ? "Enrollment expired — verify again" : "Verify with World ID"}
                        </a>
                      )
                    )}
                    {enrollMsg && <span className="label" style={{ color: "var(--loss)" }}>{enrollMsg}</span>}
                  </div>
                </div>
              </div>

              <div className={`${cls(4)} ${step < 4 ? "step-lock" : ""}`}>
                <span className="step-n">{step > 4 ? "✓" : "4"}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="step-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    Publish the rules <PoweredBy sponsor="ens" label="as" />
                  </div>
                  <label className="field">
                    <span className="label">ens name</span>
                    <div className="term-search">
                      <input value={form.label} onChange={(e) => update({ label: e.target.value.toLowerCase() })} placeholder="agent1" />
                      <span className="label">.{ENS_PARENT}</span>
                    </div>
                    <span className="field-hint">non-transferable, so the policy can&apos;t be moved to dodge its identity binding</span>
                  </label>
                  {input("agent", "agent key", "the only key that can spend, and write its own streak, nothing else")}
                  {input("payout", "payout address", "fixed forever; must differ from the agent key and every allowlisted counterparty")}
                  <div className="grid-2">
                    {input("coverage", "coverage (usdc)")}
                    {input("cap", "per-tx cap (usdc)")}
                  </div>
                  <label className="field">
                    <span className="label">counterparty allowlist</span>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={form.allowlist}
                      onChange={(e) => update({ allowlist: e.target.value })}
                      placeholder="0x… one per line"
                    />
                    <span className="field-hint">
                      {allow.length} address{allow.length === 1 ? "" : "es"} · best tier for these rules: {best} ({TIER_NAMES[best].toLowerCase()})
                    </span>
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {([0, 1, 2] as const).map((t) => (
                      <button
                        key={t}
                        disabled={t > best}
                        onClick={() => update({ tier: t })}
                        className={`filter-pill ${tier === t ? "filter-on" : ""}`}
                        title={t > best ? "tighten the cap / add an allowlist to unlock" : ""}
                      >
                        tier {t} · {TIER_NAMES[t]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={`${cls(5)} ${step < 4 ? "step-lock" : ""}`}>
                <span className="step-n">{issuedNode ? "✓" : "5"}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="step-title">Pay the premium and issue</div>
                  {problems.length > 0 && step >= 4 && (
                    <ul style={{ fontSize: 12, color: "var(--loss)", paddingLeft: 16, listStyle: "square" }}>
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-signal"
                      disabled={step < 4 || problems.length > 0 || write.isPending || !deployments.data?.PolicyRegistry}
                      onClick={() => void buy()}
                    >
                      {write.isPending ? "confirm in wallet…" : `Insure for ${premium.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`}
                    </button>
                    {status && (
                      <span
                        className="label"
                        style={{
                          textTransform: "none",
                          letterSpacing: 0,
                          fontSize: 12,
                          color: status.tone === "bad" ? "var(--loss)" : status.tone === "ok" ? "var(--gain)" : "var(--muted)",
                        }}
                      >
                        {status.text} <TxLink hash={status.tx} />
                      </span>
                    )}
                  </div>
                  {issuedNode && (
                    <Link href={`/policy/${form.label}`} className="btn" style={{ alignSelf: "flex-start" }}>
                      open {form.label}.{ENS_PARENT} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ---- live pricing ---- */}
          <aside style={{ minWidth: 0 }}>
            <div className="sticky-side side-card" style={{ padding: "20px 20px 22px" }}>
              <PricingBreakdown coverage={coverage} tier={tier} streak={0} claims={0} periods={0} />
              <p style={{ marginTop: 14, fontSize: 12, color: "var(--faint)" }}>
                New agents start at the 5% pool prior. As the clean streak grows, credibility shifts weight onto the agent&apos;s own
                record and the discount climbs to 20%. Tighter rules, cheaper tier: enforcement bounds the maximum loss.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

export default function InsurePage() {
  return (
    <Suspense fallback={<div className="label flick" style={{ padding: 80 }}>loading…</div>}>
      <InsureInner />
    </Suspense>
  );
}
