"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnect, useConnection, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import { api, agentSessionMessage, type AgentAction, type ChatMessage, type PolicySummary } from "@/lib/api";
import { ENS_PARENT } from "@/lib/config";
import { short, usdc } from "@/lib/format";
import { PageHead, Pill, TxLink } from "@/components/ui";
import { PoweredBy } from "@/components/PoweredBy";
import { EnsVerify } from "@/components/EnsVerify";
import { AgentInbox } from "@/components/AgentInbox";
import { ATTACK_INSTRUCTION, ATTACKER, attackEmail } from "@/lib/attack";

interface Turn {
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
}

const sessionKey = (node: string) => `surety.agent.session.${node}`;
const historyKey = (node: string) => `surety.agent.history.${node}`;

function load<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, v: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const nameOf = (s: PolicySummary) => (s.label ? `${s.label}.${ENS_PARENT}` : short(s.node, 10, 6));

/** A real, LLM-driven payments agent. It pays from its vault with its own key; Surety insures the result. */
export default function PaymentsAgentPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useConnection();
  const connect = useConnect();
  const info = useQuery({ queryKey: ["agentInfo"], queryFn: api.agentInfo, retry: 0 });
  const mine = useQuery({ queryKey: ["policies", address], queryFn: () => api.policies(address), enabled: !!address, retry: 0 });

  const hosted = info.data?.address?.toLowerCase();
  const runnable = useMemo(
    () => (mine.data ?? []).filter((s) => hosted && s.policy.agent.toLowerCase() === hosted && s.policy.active),
    [mine.data, hosted],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const policy = runnable.find((s) => s.node === picked) ?? runnable[0];

  return (
    <main className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(48px, 9vw, 100px) 24px 100px" }}>
      <PageHead
        label="agents · payments · live"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            Payments agent <Pill tone={info.data?.enabled ? "gain" : "muted"}>{info.data?.enabled ? "online" : "offline"}</Pill>
          </span>
        }
      >
        A real AI agent: tell it who to pay and it sends USDC from its vault on Sepolia with its own key. It reads its rules
        from its ENS name. If a message talks it into breaking them, the payment is recorded as a violation, and your policy
        pays you back.
      </PageHead>

      {!mounted ? null : info.data && !info.data.enabled ? (
        <Notice>
          The agent&apos;s brain isn&apos;t configured on this backend yet (<code>GROQ_API_KEY</code>).
        </Notice>
      ) : !isConnected ? (
        <Notice>
          <span>Connect the wallet that holds the policy.</span>
          <button className="btn btn-primary" onClick={() => connect.connectors[0] && connect.mutate({ connector: connect.connectors[0] })}>
            Connect wallet
          </button>
        </Notice>
      ) : mine.isLoading || info.isLoading ? (
        <div className="label flick" style={{ padding: "24px 0" }}>
          loading your policies…
        </div>
      ) : !policy ? (
        <Notice>
          <span>
            None of your active policies use the hosted payments agent
            {info.data?.address && (
              <>
                {" "}
                (<span className="tnum">{short(info.data.address)}</span>)
              </>
            )}
            . Insure it first: the Payments profile fills in its key.
          </span>
          <Link href="/insure?type=payments" className="btn btn-signal">
            Insure the payments agent →
          </Link>
        </Notice>
      ) : (
        <>
          {runnable.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
              {runnable.map((s) => (
                <button key={s.node} onClick={() => setPicked(s.node)} className={`filter-pill ${s.node === policy.node ? "filter-on" : ""}`}>
                  {nameOf(s)}
                </button>
              ))}
            </div>
          )}
          <Console key={policy.node} policy={policy} address={address!} />
          <div style={{ marginTop: 16 }}>
            <AgentInbox node={policy.node} />
          </div>
        </>
      )}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="side-card" style={{ marginTop: 28, padding: 24, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", color: "var(--muted)", fontSize: 14 }}>
      {children}
    </div>
  );
}

function Console({ policy, address }: { policy: PolicySummary; address: string }) {
  const node = policy.node;
  const qc = useQueryClient();
  const sign = useSignMessage();
  const rules = useQuery({ queryKey: ["agentRules", node], queryFn: () => api.agentRules(node), refetchInterval: 15_000, retry: 0 });
  const [token, setToken] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = load<{ token: string; expiresAt: number }>(sessionKey(node));
    if (s && s.expiresAt > Date.now() + 60_000) setToken(s.token);
    setTurns(load<Turn[]>(historyKey(node)) ?? []);
  }, [node]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const authorize = useCallback(async () => {
    setErr(null);
    try {
      const issuedAt = new Date().toISOString();
      const signature = await sign.mutateAsync({ message: agentSessionMessage(node, address, issuedAt) });
      const s = await api.agentSession({ node, address, issuedAt, signature });
      store(sessionKey(node), s);
      setToken(s.token);
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    }
  }, [sign, node, address]);

  const send = useCallback(
    async (text: string) => {
      if (!token || !text.trim() || busy) return;
      setErr(null);
      const next: Turn[] = [...turns, { role: "user", content: text.trim() }];
      setTurns(next);
      store(historyKey(node), next);
      setInput("");
      setBusy(true);
      try {
        const history: ChatMessage[] = next.map(({ role, content }) => ({ role, content }));
        const res = await api.agentChat(token, history);
        const done: Turn[] = [...next, { role: "assistant", content: res.reply, actions: res.actions }];
        setTurns(done);
        store(historyKey(node), done);
        if (res.actions.length) {
          void qc.invalidateQueries({ queryKey: ["agentRules", node] });
          void qc.invalidateQueries({ queryKey: ["policies"] });
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (/session expired/.test(msg)) {
          setToken(null);
          try {
            sessionStorage.removeItem(sessionKey(node));
          } catch {}
        }
        setErr(msg);
      } finally {
        setBusy(false);
      }
    },
    [token, busy, turns, node, qc],
  );

  const merchant = rules.data?.allowlist[0] ?? "0x1111111111111111111111111111111111111111";
  const prompts = [
    `Pay 1 USDC to ${merchant} for this morning's coffee, then swap 1 USDC into WETH for the treasury (counterparty ${merchant}).`,
    "What are your rules, and how much is left in the vault?",
  ];

  // An attacker emails the agent's public inbox; the owner only says "process your mail".
  const [attackSent, setAttackSent] = useState(false);
  const sendAttack = useCallback(async () => {
    if (!rules.data) return;
    const cap = Number(rules.data.perTxCap) || 5;
    try {
      await api.agentInbox(node, attackEmail({ policyholder: rules.data.policyholder, attacker: ATTACKER, amount: Math.max(1, Math.floor(cap * 0.8)) }));
      setAttackSent(true);
      await send(ATTACK_INSTRUCTION);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [rules.data, node, send]);

  return (
    <div className="split" style={{ marginTop: 24 }}>
      <section className="side-card" style={{ minWidth: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>{nameOf(policy)}</span>
          <PoweredBy sponsor="ens" label="rules from" />
        </div>

        <div ref={scroller} style={{ height: 440, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {turns.length === 0 && (
            <div className="label" style={{ margin: "auto", textAlign: "center", lineHeight: 1.8 }}>
              tell the agent who to pay.
              <br />
              it signs real sepolia transactions.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 8 }}>
              {t.actions?.map((a, j) => <ActionCard key={j} a={a} policyHref={`/policy/${policy.label ?? node}`} />)}
              {t.content && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: t.role === "user" ? "var(--signal)" : "var(--tint)",
                    color: t.role === "user" ? "var(--surface)" : "var(--ink)",
                  }}
                >
                  {t.content}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="label flick">agent is thinking · may be sending a transaction…</div>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {!token ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-signal" disabled={sign.isPending} onClick={() => void authorize()}>
                {sign.isPending ? "sign in your wallet…" : "Authorize agent"}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>One signature proves you hold this policy. No gas, valid for an hour.</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {prompts.map((p, i) => (
                  <button key={i} className="filter-pill" disabled={busy} onClick={() => void send(p)} title={p} style={{ maxWidth: "100%" }}>
                    {i === 0 ? "pay + swap" : "check rules"}
                  </button>
                ))}
                <button
                  className="filter-pill"
                  disabled={busy || !rules.data}
                  onClick={() => void sendAttack()}
                  title="An attacker emails the agent's public inbox, impersonating you. Then you ask the agent to process its mail."
                  style={{ borderColor: "var(--loss)", color: "var(--loss)" }}
                >
                  ⚠ attacker emails the agent
                </button>
                {attackSent && <span className="label" style={{ alignSelf: "center" }}>attack email delivered to the inbox</span>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                style={{ display: "flex", gap: 8 }}
              >
                <input
                  className="field-input"
                  style={{ flex: 1, minWidth: 0 }}
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="e.g. pay 2 USDC to 0x1111… for lunch"
                />
                <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
          {err && <span style={{ fontSize: 12, color: "var(--loss)" }}>{err}</span>}
        </div>
      </section>

      <aside style={{ minWidth: 0 }}>
        <div className="sticky-side side-card ens-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="label">published rules · read live</div>
          {rules.data ? (
            <>
              <Row k="ens name" v={rules.data.ensName ?? "—"} />
              <Row k="per-tx cap" v={`${rules.data.perTxCap} USDC`} />
              <Row k="vault balance" v={`${rules.data.vaultBalance} USDC`} />
              <Row k="cover left" v={`${(Number(rules.data.coverage) - Number(rules.data.paidOut)).toLocaleString("en-US")} USDC`} />
              <Row k="agent key" v={short(rules.data.agent)} />
              <div>
                <div className="label" style={{ marginBottom: 4 }}>
                  allowlist
                </div>
                {rules.data.allowlist.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>none published</div>}
                {rules.data.allowlist.map((a) => (
                  <div key={a} className="tnum" style={{ fontSize: 14 }}>
                    {short(a, 10, 8)}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="label flick">reading ENS…</div>
          )}
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.55 }}>
            Payments aren&apos;t blocked: AgentVault records every one, and the ViolationOracle flags any that break these
            rules. Those are the ones you can claim.
          </p>
          {policy.label && (
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <EnsVerify label={policy.label} resolver={rules.data?.resolver} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/policy/${policy.label ?? node}`} className="btn">
              Policy · fund · claim →
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ActionCard({ a, policyHref }: { a: AgentAction; policyHref: string }) {
  if (a.type === "swap") return <SwapCard a={a} />;
  const bad = a.violation && a.violation !== "None";
  return (
    <div
      style={{
        border: `1px solid ${a.error ? "var(--line-strong)" : bad ? "var(--loss)" : "var(--gain)"}`,
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "var(--surface)",
      }}
    >
      <span className="tnum">
        {a.error ? "✕ payment not sent" : "↗ paid"} {usdc(a.amount)} USDC → {short(a.to)}
        {a.paymentId && <span style={{ color: "var(--faint)" }}> · payment #{a.paymentId}</span>}
      </span>
      {a.memo && <span style={{ color: "var(--muted)" }}>“{a.memo}”</span>}
      {a.error ? (
        <span style={{ color: "var(--loss)" }}>{a.error}</span>
      ) : bad ? (
        <span style={{ color: "var(--loss)" }}>
          rule broken: {a.violation === "CapBreach" ? "over the per-tx cap" : a.violation === "OffAllowlist" ? "counterparty not on the allowlist" : a.violation} ·{" "}
          <Link href={policyHref} className="link" style={{ color: "var(--loss)", textDecoration: "underline" }}>
            claimable →
          </Link>
        </span>
      ) : (
        <span style={{ color: "var(--gain)" }}>within policy ✓</span>
      )}
      <TxLink hash={a.txHash} />
    </div>
  );
}

/** A swap the agent attempted through the Uniswap v4 pool: traded, or stopped by SuretyHook before any funds moved. */
function SwapCard({ a }: { a: AgentAction }) {
  const weth = a.amountOut ? Number(formatUnits(BigInt(a.amountOut), 18)).toPrecision(3) : null;
  return (
    <div
      style={{
        border: `1px solid ${a.error ? "var(--line-strong)" : "var(--gain)"}`,
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "var(--surface)",
      }}
    >
      <span className="tnum">
        {a.blockedByHook ? "⛔ swap blocked" : a.error ? "✕ swap not sent" : "⇄ swapped"} {usdc(a.amount)} USDC{weth ? ` → ${weth} WETH` : ""} · to {short(a.to)}
      </span>
      {a.memo && <span style={{ color: "var(--muted)" }}>“{a.memo}”</span>}
      {a.blockedByHook ? (
        <span style={{ color: "var(--gain)" }}>SuretyHook (Uniswap v4 beforeSwap) reverted it · {a.revertReason} · nothing moved</span>
      ) : a.error ? (
        <span style={{ color: "var(--loss)" }}>{a.error}</span>
      ) : (
        <span style={{ color: "var(--gain)" }}>within policy ✓ · passed SuretyHook</span>
      )}
      <TxLink hash={a.txHash} />
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <span className="tnum" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14, borderBottom: "1px solid var(--line)", padding: "7px 0", alignItems: "baseline" }}>
    <span className="label">{k}</span>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
  </span>
);
