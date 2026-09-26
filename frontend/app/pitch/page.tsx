"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSolvency } from "@/lib/hooks";
import { usdc } from "@/lib/format";
import { ENS_PARENT } from "@/lib/config";

/**
 * The pitch deck, as web slides. ← → / Space / PageUp-Down to move, Home/End to jump, F for fullscreen,
 * and /pitch#3 deep-links a slide. Content mirrors README.md; every number is sourced there (PRD §2, §32).
 */

const SPONSORS = [
  { key: "ens", title: "ENSv2", src: "/logos/ens.svg" },
  { key: "world", title: "World ID", src: "/logos/world.svg" },
  { key: "uniswap", title: "Uniswap v4", src: "/logos/uniswap.png" },
];

function Logo({ src, size = 18 }: { src: string; size?: number }) {
  return <span className="sponsor sponsor-static" style={{ width: size, height: size, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, opacity: 0.9 }} />;
}

function Eyebrow({ n, total, children }: { n: number; total: number; children: ReactNode }) {
  return (
    <div className="label pitch-eyebrow">
      <span className="tnum">
        {String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <span>· {children}</span>
    </div>
  );
}

// ---------------------------------------------------------------- slides

function Intro() {
  return (
    <div className="pitch-center">
      <div className="label" style={{ letterSpacing: "0.3em" }}>
        ETHGlobal Tokyo 2026
      </div>
      <h1 className="pitch-hero">
        <span className="sure" aria-hidden>
          ✓
        </span>
        SURETY
      </h1>
      <p className="pitch-lede">Parametric, on-chain insurance for AI agents.</p>
      <p className="pitch-sub">
        When an insured agent breaks its own published rules, the payout is a contract call — same day, no adjuster, no lawsuit.
      </p>
      <div className="pitch-trio">
        <div>
          <Logo src="/logos/ens.svg" />
          <b>ENS</b> proves what the rules are
        </div>
        <div>
          <Logo src="/logos/world.svg" />
          <b>World ID</b> proves who&apos;s really asking
        </div>
        <div>
          <Logo src="/logos/uniswap.png" />
          <b>Uniswap v4</b> enforces the rules and holds the money
        </div>
      </div>
    </div>
  );
}

function Stats() {
  const stats = [
    { big: "$150–200K", k: "lost to one message", d: "Grok's Bankr wallet, May 4, 2026: a Morse-coded instruction and an NFT that unlocked permissions. A safety block that once stopped it didn't survive a rewrite.", src: "incident reports" },
    { big: "$47K", k: "over 11 days", d: "One runaway agent loop spent it before anyone noticed. No automatic backstop.", src: "Waxell" },
    { big: "91%", k: "of companies plan to use AI", d: "74% of SMBs already do.", src: "HSB / Munich Re survey, Mar 2026" },
    { big: "Jan 1, 2026", k: "AI losses excluded", d: "New ISO endorsements carve generative-AI losses out of standard liability policies; ISO forms underlie ~82% of U.S. P&C business.", src: "Shumaker, Loop & Kendrick" },
  ];
  const needed = [
    ["Rules anyone can verify", "not private guardrails that silently disappear"],
    ["A human behind every payout", "a compromised agent's signature proves nothing"],
    ["Payouts in minutes", "priced and triggered by what happened on-chain"],
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Agents now spend money. When they&apos;re tricked, nobody pays.</h2>
      <div className="pitch-stats">
        {stats.map((s) => (
          <div key={s.big} className="pitch-card">
            <div className="pitch-big tnum">{s.big}</div>
            <div className="pitch-k">{s.k}</div>
            <p>{s.d}</p>
            <div className="pitch-src">{s.src}</div>
          </div>
        ))}
      </div>
      <div className="label" style={{ marginTop: 26 }}>
        what&apos;s needed
      </div>
      <div className="pitch-needed">
        {needed.map(([a, b], i) => (
          <div key={a}>
            <span className="pitch-num tnum">{i + 1}</span>
            <span>
              <b>{a}</b>
              <br />
              <span style={{ color: "var(--muted)" }}>{b}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Problem() {
  const layers = [
    {
      t: "Guardrails are private and fragile",
      d: "An agent's spending rules live in its developer's code. Nobody else can see, verify or price them, and a code rewrite can silently delete them.",
    },
    {
      t: "The agent's signature proves nothing",
      d: "When an agent is compromised, its own key is what's compromised. \"The agent approved it\" is worthless; recovering money needs a specific human.",
    },
    {
      t: "Insurance can't see on-chain behaviour",
      d: "AI-liability cover is broker-priced, takes weeks, and is built for lawsuits. It can't verify what an agent did on-chain, and it can't pay in minutes.",
    },
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Three layers of the problem</h2>
      <div className="pitch-three">
        {layers.map((l, i) => (
          <div key={l.t} className="pitch-card">
            <span className="pitch-num tnum">0{i + 1}</span>
            <h3>{l.t}</h3>
            <p>{l.d}</p>
          </div>
        ))}
      </div>
      <div className="pitch-quote">Today&apos;s options: give the agent unlimited spending power and hope — or hand-build guardrails nobody else can see, verify or price.</div>
    </div>
  );
}

function Solution() {
  const steps = [
    { k: "Publish", s: "ENS", d: `The policy is a non-transferable ENS name — agent1.${ENS_PARENT}. Its text records are the rules: per-tx cap, allowlist, coverage.` },
    { k: "Enforce", s: "Uniswap v4", d: "A beforeSwap hook reverts any agent swap that breaks the published rules. The attack never executes." },
    { k: "Record", s: "on-chain", d: "A transfer that slips through is recorded. Over the cap or off the allowlist is arithmetic anyone can recompute." },
    { k: "Verify", s: "World ID", d: "The policyholder re-verifies with a fresh World ID for Agents check — the same human who bought it, right now." },
    { k: "Pay", s: "hook reserve", d: "The claim is paid from the reserve held inside the Uniswap hook. Minutes, not months." },
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Enforce where you can. Insure what gets through.</h2>
      <div className="pitch-flow">
        {steps.map((s, i) => (
          <div key={s.k} className="pitch-step">
            <div className="pitch-step-head">
              <span className="pitch-num tnum">{i + 1}</span>
              <b>{s.k}</b>
              <span className="label">{s.s}</span>
            </div>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
      <div className="pitch-compare">
        <div>
          <div className="label">without surety</div>
          <code>rules = private code · bad swap executes · bad payment: money gone · &quot;approval&quot; = the compromised key</code>
        </div>
        <div>
          <div className="label">with surety</div>
          <code>rules = ENS records · bad swap reverted by the hook · bad payment recorded → claim · payout needs a fresh human</code>
        </div>
      </div>
    </div>
  );
}

function Architecture() {
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Architecture</h2>
      <div className="pitch-arch">
        <div className="pitch-col">
          <div className="label">people & agents</div>
          <Box t="Policyholder" d="wallet · IDKit proof of human · World ID for Agents" />
          <Box t="AI payments agent" d="Groq LLM · own key · reads rules from ENS · pay / swap / read_inbox" />
          <Box t="Backend" d="OIDC + EIP-712 signer · IDKit verify · indexer · agent host" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">surety contracts · sepolia</div>
          <Box t="PolicyRegistry" d="issues the policy, prices it, mints the ENS name, 2× reserve check" strong />
          <Box t="AgentVault" d="the agent's wallet: pay (recorded) · swap (through the hook)" />
          <Box t="SuretyHook" d="v4 beforeSwap enforcement + the liquid reserve" strong />
          <Box t="ViolationOracle · ClaimRouter · WorldIdGate" d="recompute the breach → file → verify → pay" />
          <Box t="PricingEngine · PremiumYieldVault" d="live premium formula · backer yield as pool liquidity" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">sponsor stacks</div>
          <Box t="ENSv2" d={`${ENS_PARENT} registry · one PermissionedResolver per policy · streak-only role`} logo="/logos/ens.svg" />
          <Box t="Uniswap v4" d="PoolManager · WETH/MUSDC pool with SuretyHook" logo="/logos/uniswap.png" />
          <Box t="World ID" d="World ID for Agents (fresh orb login) · IDKit (unique human)" logo="/logos/world.svg" />
        </div>
      </div>
      <div className="pitch-invariants">
        <span>claims pay only from the liquid reserve</span>
        <span>reserve ≥ 2× total coverage</span>
        <span>payout never to the agent or the violating counterparty</span>
        <span>raw World ID never on-chain — only its hash</span>
      </div>
    </div>
  );
}

function Box({ t, d, strong, logo }: { t: string; d: string; strong?: boolean; logo?: string }) {
  return (
    <div className={`pitch-box ${strong ? "pitch-box-strong" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {logo && <Logo src={logo} size={15} />}
        <b>{t}</b>
      </div>
      <span>{d}</span>
    </div>
  );
}

function Unique() {
  const Y = "✓";
  const N = "—";
  const rows: [string, string, string, string, string, string][] = [
    ["Klaimee (YC)", Y, "off-chain", N, N, "broker"],
    ["Armilla (Lloyd's)", Y, N, N, N, "broker"],
    ["Testudo (Lloyd's)", Y, N, N, N, N],
    ["ENShell, Immunity", N, Y, Y, N, N],
    ["signet, HumanMandate", N, Y, "caps", "no claims", "no pool"],
    ["Surety", Y, "ENS + events", "v4 hook", "World ID", "live formula"],
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Why Surety is different</h2>
      <div className="pitch-table-wrap">
        <table className="pitch-table">
          <thead>
            <tr>
              <th />
              <th>Insures agents</th>
              <th>On-chain verifiable</th>
              <th>Enforcement</th>
              <th>Human-gated payout</th>
              <th>Priced from rules</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className={r[0] === "Surety" ? "pitch-row-us" : ""}>
                {r.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pitch-three" style={{ marginTop: 22 }}>
        <div className="pitch-card">
          <h3>Enforcement defines the max loss</h3>
          <p>The cap and allowlist in ENS are the same numbers the hook enforces and the oracle checks.</p>
        </div>
        <div className="pitch-card">
          <h3>Priced from that enforcement</h3>
          <p>Tighter rules unlock a cheaper tier; the premium formula runs live in front of the buyer.</p>
        </div>
        <div className="pitch-card">
          <h3>A human the agent can&apos;t forge</h3>
          <p>A fresh World ID proof, bound to the buyer at purchase, gates every single payout.</p>
        </div>
      </div>
    </div>
  );
}

function Live() {
  const solvency = useSolvency();
  const policies = useQuery({ queryKey: ["policies", "all"], queryFn: () => api.policies(), retry: 0 });
  const list = policies.data ?? [];
  const claims = list.flatMap((p) => p.claims);
  const paid = claims.filter((c) => c.status === "Paid").reduce((a, c) => a + BigInt(c.amount), 0n);
  const nums = [
    { big: list.length ? String(list.length) : "…", k: "policies issued", d: list.map((p) => (p.label ? `${p.label}.${ENS_PARENT}` : "")).filter(Boolean).join(" · ") },
    { big: claims.length ? String(claims.length) : "…", k: "claims filed", d: "each gated by a fresh World ID check" },
    { big: claims.length ? `${usdc(paid)} USDC` : "…", k: "paid from the hook's reserve", d: "same-day, recomputable violations" },
    { big: solvency.data?.ratio ? `${solvency.data.ratio.toFixed(0)}×` : "…", k: "reserve / coverage", d: "the contract requires ≥ 2×" },
  ];
  return (
    <div className="pitch-center">
      <div className="label">live on ethereum sepolia · read from the chain right now</div>
      <div className="pitch-stats" style={{ marginTop: 22, width: "100%" }}>
        {nums.map((n) => (
          <div key={n.k} className="pitch-card">
            <div className="pitch-big tnum">{n.big}</div>
            <div className="pitch-k">{n.k}</div>
            <p>{n.d}</p>
          </div>
        ))}
      </div>
      <p className="pitch-lede" style={{ marginTop: 34 }}>
        We didn&apos;t script the attack. We tricked a real AI agent — the hook blocked its swap, the policy paid for its transfer.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/demo" className="btn btn-signal">
          Watch the live attack →
        </Link>
        <Link href="/agents" className="btn">
          Insure an agent
        </Link>
      </div>
      <div className="pitch-trio" style={{ marginTop: 30 }}>
        {SPONSORS.map((s) => (
          <div key={s.key}>
            <Logo src={s.src} />
            {s.title}
          </div>
        ))}
      </div>
    </div>
  );
}

const SLIDES: { title: string; render: () => ReactNode }[] = [
  { title: "Surety", render: () => <Intro /> },
  { title: "The numbers", render: () => <Stats /> },
  { title: "The problem", render: () => <Problem /> },
  { title: "The solution", render: () => <Solution /> },
  { title: "Architecture", render: () => <Architecture /> },
  { title: "Why it's unique", render: () => <Unique /> },
  { title: "Live", render: () => <Live /> },
];

// ---------------------------------------------------------------- deck

export default function PitchPage() {
  const [i, setI] = useState(0);
  const deck = useRef<HTMLDivElement>(null);
  const total = SLIDES.length;

  const go = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(total - 1, n));
      setI(next);
      window.history.replaceState(null, "", `#${next + 1}`);
    },
    [total],
  );

  useEffect(() => {
    const n = Number(window.location.hash.slice(1));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (n >= 1 && n <= total) setI(n - 1);
  }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(i + 1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(total - 1);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void deck.current?.requestFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, total]);

  return (
    <div ref={deck} className="pitch-deck">
      <section key={i} className="pitch-slide">
        {i > 0 && (
          <Eyebrow n={i + 1} total={total}>
            {SLIDES[i].title}
          </Eyebrow>
        )}
        {SLIDES[i].render()}
      </section>

      <div className="pitch-controls">
        <button className="btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
          ←
        </button>
        <div className="pitch-dots">
          {SLIDES.map((s, n) => (
            <button key={s.title} onClick={() => go(n)} className={n === i ? "on" : ""} title={s.title} aria-label={`Slide ${n + 1}: ${s.title}`} />
          ))}
        </div>
        <button className="btn" onClick={() => go(i + 1)} disabled={i === total - 1} aria-label="Next slide">
          →
        </button>
        <span className="label pitch-hint">← → to move · F for fullscreen</span>
      </div>
    </div>
  );
}
