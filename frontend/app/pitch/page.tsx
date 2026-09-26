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
        <span className="sure" aria-hidden />
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
    {
      big: "$150–200K",
      k: "lost to one message",
      d: "A Morse-coded message tricked Grok's Bankr agent into sending it. The safety block that once stopped this didn't survive a rewrite.",
      src: "Grok / Bankr wallet · May 4, 2026",
    },
    {
      big: "$47K",
      k: "burned by a runaway loop",
      d: "One agent kept spending for 11 days before anyone noticed. There was no automatic backstop.",
      src: "Waxell",
    },
    {
      big: "91%",
      k: "of companies plan to use AI",
      d: "74% of small businesses already do — so more agents will hold money on their customers' behalf.",
      src: "HSB / Munich Re survey · Mar 2026",
    },
    {
      big: "Jan 1, 2026",
      k: "AI losses excluded from cover",
      d: "New ISO endorsements carve generative-AI losses out of standard liability policies. ISO forms underlie ~82% of U.S. P&C business.",
      src: "Shumaker, Loop & Kendrick",
    },
  ];
  const needed = ["Rules anyone can verify", "A human behind every payout", "Payouts in minutes, not months"];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Agents now spend money. When they&apos;re tricked, nobody pays.</h2>
      <div className="pitch-stats">
        {stats.map((s) => (
          <div key={s.big} className="pitch-card pitch-stat">
            <div className="pitch-big tnum">{s.big}</div>
            <div className="pitch-k">{s.k}</div>
            <p>{s.d}</p>
            <div className="pitch-src">{s.src}</div>
          </div>
        ))}
      </div>
      <div className="pitch-needed">
        <span className="label">what&apos;s needed</span>
        {needed.map((n, i) => (
          <span key={n} className="pitch-chip">
            <span className="pitch-num tnum">{i + 1}</span>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Problem() {
  const layers = [
    {
      t: "No insurance when you use someone else's agent",
      d: "When a company's trading, payments or support agent handles your money and gets tricked, you carry the loss. No product covers it — and standard policies now exclude AI losses.",
      e: "e.g. an exchange's trading bot, a merchant's checkout agent",
    },
    {
      t: "The agent's key proves nothing",
      d: "A manipulated agent signs whatever it's told with a perfectly valid key. \"The agent approved it\" can't be the basis for a payout — only a real human can.",
      e: "e.g. one Morse-coded message → valid, signed transfers",
    },
    {
      t: "Insurance can't see on-chain",
      d: "AI-liability cover is broker-priced, takes weeks and is built for lawsuits. It can't verify what an agent did on-chain, so it can't pay the same day.",
      e: "e.g. Klaimee, Armilla, Testudo — all off-chain",
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
            <div className="pitch-src">{l.e}</div>
          </div>
        ))}
      </div>
      <p className="pitch-foot">Today, whoever trusts an AI agent with money carries 100% of the risk.</p>
    </div>
  );
}

function Solution() {
  const steps = [
    { k: "Publish", s: "ENS", d: `Buying cover mints agent1.${ENS_PARENT}. Its text records are the rules: per-tx cap, allowlist, coverage.` },
    { k: "Enforce", s: "Uniswap v4", d: "SuretyHook checks every agent swap in beforeSwap and reverts the ones that break the rules." },
    { k: "Record", s: "on-chain", d: "Plain transfers can't be blocked, so they're recorded. Over the cap or off the allowlist is arithmetic anyone can recompute." },
    { k: "Verify", s: "World ID", d: "The policyholder passes a fresh World ID for Agents check — the same human bound to the policy at purchase." },
    { k: "Pay", s: "hook reserve", d: "The claim is paid from the reserve inside the hook — same day, never to the attacker or the agent." },
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">Enforce where you can. Insure what gets through.</h2>
      <div className="pitch-flow">
        {steps.map((s, i) => (
          <div key={s.k} className="pitch-step">
            <span className="pitch-num tnum">{i + 1}</span>
            <b>{s.k}</b>
            <span className="label">{s.s}</span>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
      <div className="pitch-compare">
        <div>
          <div className="label">without surety</div>
          <code>private rules · bad swaps execute · stolen money is gone · the compromised key &quot;approves&quot;</code>
        </div>
        <div>
          <div className="label">with surety</div>
          <code>rules in ENS · bad swaps reverted · bad transfers claimable · a fresh human approves the payout</code>
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
          <Box t="Policyholder" d="buys cover · IDKit unique human · World ID for Agents at claim time" />
          <Box t="AI payments agent" d="Groq LLM with its own key · reads its rules from ENS · pay / swap" />
          <Box t="Backend" d="validates World ID · signs EIP-712 approvals · indexes events" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">surety contracts · sepolia</div>
          <Box t="PolicyRegistry" d="issues and prices the policy, mints its ENS name, checks the 2× reserve" strong />
          <Box t="AgentVault" d="the agent's wallet: payments are recorded, swaps go through the hook" />
          <Box t="SuretyHook" d="beforeSwap enforcement + the liquid reserve that pays claims" strong />
          <Box t="ViolationOracle · ClaimRouter · WorldIdGate" d="recompute the breach → file → verify the human → pay" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">sponsor stacks</div>
          <Box t="ENSv2" d="surety.eth registry · one PermissionedResolver per policy" logo="/logos/ens.svg" />
          <Box t="Uniswap v4" d="PoolManager · WETH/MUSDC pool with SuretyHook" logo="/logos/uniswap.png" />
          <Box t="World ID" d="World ID for Agents (fresh login) · IDKit (unique human)" logo="/logos/world.svg" />
        </div>
      </div>
      <div className="pitch-invariants">
        <span>claims pay only from the liquid reserve</span>
        <span>reserve ≥ 2× total coverage</span>
        <span>never pays the agent or the attacker</span>
        <span>only a hash of the World ID on-chain</span>
      </div>
    </div>
  );
}

function Box({ t, d, strong, logo }: { t: string; d: string; strong?: boolean; logo?: string }) {
  return (
    <div className={`pitch-box ${strong ? "pitch-box-strong" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {logo && <Logo src={logo} size={17} />}
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
    ["Klaimee · Armilla · Testudo", Y, N, N, N, "broker"],
    ["ENShell · Immunity", N, Y, Y, N, N],
    ["signet · HumanMandate", N, Y, "caps", N, N],
    ["Surety", Y, Y, Y, Y, "live formula"],
  ];
  const points = [
    ["Enforcement defines the max loss", "The cap and allowlist in ENS are the numbers the hook enforces and the oracle checks."],
    ["Priced from that enforcement", "Tighter rules unlock a cheaper tier, and the premium is computed live in front of the buyer."],
    ["A human the agent can't forge", "A fresh World ID proof, bound to the buyer at purchase, gates every payout."],
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
              <th>Enforces rules</th>
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
        {points.map(([t, d]) => (
          <div key={t} className="pitch-card">
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
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
