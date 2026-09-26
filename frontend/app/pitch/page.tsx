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
    { big: "$150–200K", k: "lost to one message", src: "Grok / Bankr wallet · May 4, 2026" },
    { big: "$47K", k: "burned by a runaway loop", src: "Waxell · over 11 days" },
    { big: "91%", k: "of companies plan to use AI", src: "HSB / Munich Re · Mar 2026" },
    { big: "Jan 1, 2026", k: "AI losses excluded from cover", src: "ISO endorsements" },
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
    { t: "No insurance for AI agents", d: "Whether you run your own agent or use someone else's, nothing covers what it spends — and standard policies now exclude AI losses." },
    { t: "The agent's key proves nothing", d: "A compromised agent signs whatever it's told. Money needs a real human." },
    { t: "Insurance can't see on-chain", d: "Broker-priced, weeks to pay, built for lawsuits." },
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
    </div>
  );
}

function Solution() {
  const steps = [
    { k: "Publish", s: "ENS", d: "The policy is an ENS name. Its records are the rules." },
    { k: "Enforce", s: "Uniswap v4", d: "The hook reverts rule-breaking swaps." },
    { k: "Record", s: "on-chain", d: "A transfer that slips through is recorded and recomputable." },
    { k: "Verify", s: "World ID", d: "A fresh check by the same human who bought it." },
    { k: "Pay", s: "hook reserve", d: "Paid from the reserve inside the hook. Minutes." },
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
          <Box t="Policyholder" d="wallet · World ID" />
          <Box t="AI payments agent" d="Groq LLM · its own key" />
          <Box t="Backend" d="World ID checks · EIP-712 signer" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">surety contracts</div>
          <Box t="PolicyRegistry" d="issues, prices, mints the ENS name" strong />
          <Box t="AgentVault" d="the agent's wallet: pay · swap" />
          <Box t="SuretyHook" d="enforcement + the reserve" strong />
          <Box t="ViolationOracle · ClaimRouter" d="recompute → claim → pay" />
        </div>
        <div className="pitch-arrow">→</div>
        <div className="pitch-col">
          <div className="label">sponsor stacks</div>
          <Box t="ENSv2" d="surety.eth · one resolver per policy" logo="/logos/ens.svg" />
          <Box t="Uniswap v4" d="PoolManager + SuretyHook" logo="/logos/uniswap.png" />
          <Box t="World ID" d="for Agents + IDKit" logo="/logos/world.svg" />
        </div>
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
  const rows: [string, string, string, string, string][] = [
    ["Klaimee · Armilla · Testudo", Y, N, N, N],
    ["ENShell · Immunity", N, Y, Y, N],
    ["signet · HumanMandate", N, Y, "caps", N],
    ["Surety", Y, Y, Y, Y],
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
      <p className="pitch-foot">The only one that enforces, insures, and needs a human to pay — priced from the same rules.</p>
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
