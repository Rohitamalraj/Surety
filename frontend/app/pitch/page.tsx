"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
      d: "A Morse-coded message tricked Grok's Bankr agent into sending it.",
      src: "Grok / Bankr wallet · May 4, 2026",
    },
    { big: "$47K", k: "burned by a runaway loop", d: "One agent spent for 11 days before anyone noticed.", src: "Waxell" },
    { big: "91%", k: "of companies plan to use AI", d: "74% of small businesses already do.", src: "HSB / Munich Re survey · Mar 2026" },
    {
      big: "Jan 1, 2026",
      k: "AI losses excluded from cover",
      d: "New ISO endorsements carve AI losses out of standard policies.",
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
      d: "When a company's trading or payments agent handles your money and gets tricked, you carry the loss. Nothing covers it.",
      e: "e.g. an exchange's trading bot, a merchant's checkout agent",
    },
    {
      t: "The agent's key proves nothing",
      d: "A manipulated agent signs whatever it's told with a valid key. Only a real human can approve a payout.",
      e: "e.g. one Morse-coded message → valid, signed transfers",
    },
    {
      t: "Insurance can't see on-chain",
      d: "AI-liability cover is broker-priced, takes weeks and is built for lawsuits — it can't verify what an agent did.",
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

/** What we built: the product, not the mechanism. */
function Solution() {
  const features = [
    { t: "Cover in minutes", d: "Pick a profile, set the rules, pay a premium computed live.", s: "insure" },
    { t: "The policy is an ENS name", d: `Each policy is a public name like agent1.${ENS_PARENT}. Its records are the rules.`, s: "ENSv2" },
    { t: "Rules enforced on-chain", d: "Our Uniswap v4 hook blocks rule-breaking swaps before they execute.", s: "Uniswap v4" },
    { t: "Violations detected automatically", d: "Every payment is recorded and checked from public data. No adjuster.", s: "on-chain" },
    { t: "Claims only a human can approve", d: "A fresh World ID check by the policy's buyer — a hijacked agent can't fake it.", s: "World ID" },
    { t: "Paid the same day", d: "Paid from a reserve inside the hook, kept at 2× coverage.", s: "reserve" },
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">What we built: Surety, insurance for AI agents.</h2>
      <div className="pitch-features">
        {features.map((f, i) => (
          <div key={f.t} className="pitch-card pitch-feature">
            <div className="pitch-feature-head">
              <span className="pitch-num tnum">{i + 1}</span>
              <span className="label">{f.s}</span>
            </div>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- workflow

const ICONS: Record<string, ReactNode> = {
  pick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 17.5h7M17.5 14v7" />
    </svg>
  ),
  insure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6L12 3z" />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
    </svg>
  ),
  run: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12.5h.01M15 12.5h.01M9.5 16h5" />
    </svg>
  ),
  attack: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5L2.8 19.5h18.4L12 3.5z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </svg>
  ),
  claim: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </svg>
  ),
  pay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-2.8.9-2.8 2s1 1.7 2.8 2c1.8.3 2.8.9 2.8 2.1s-1.2 2-2.8 2c-1.2 0-2.3-.5-2.9-1.3M12 6.5v11" />
    </svg>
  ),
};

function Workflow() {
  const steps = [
    { icon: "pick", phase: "choose", t: "Pick an agent", d: "Payments, trading, invoices, payroll… with suggested rules and a live quote.", tag: "/agents" },
    { icon: "insure", phase: "insure", t: "Buy cover", d: "Prove you're a unique human, enroll with World ID, pay the premium. The ENS policy is minted.", tag: "IDKit · World ID · ENS" },
    { icon: "run", phase: "operate", t: "Agent works", d: "It pays and swaps from its vault, reading its rules from its ENS name.", tag: "AgentVault" },
    { icon: "attack", phase: "attack", t: "Agent gets tricked", d: "Its swap is blocked by the hook. A plain transfer slips through — and is recorded.", tag: "Uniswap v4 hook", alert: true },
    { icon: "claim", phase: "claim", t: "File the claim", d: "The violation is recomputed on-chain. The policyholder files in one transaction.", tag: "ViolationOracle" },
    { icon: "pay", phase: "payout", t: "Get paid", d: "A fresh World ID check, then the reserve pays out. Same day.", tag: "World ID · reserve", end: true },
  ];
  return (
    <div className="pitch-body">
      <h2 className="pitch-h2">How it works, end to end</h2>
      <div className="wf">
        <div className="wf-rail" aria-hidden>
          <span className="wf-pulse" />
        </div>
        {steps.map((s, i) => (
          <div key={s.t} className={`wf-step ${s.alert ? "wf-alert" : ""} ${s.end ? "wf-end" : ""}`} style={{ animationDelay: `${i * 90}ms` }}>
            <div className="wf-phase label">
              <span className="tnum">{String(i + 1).padStart(2, "0")}</span> {s.phase}
            </div>
            <div className="wf-node">{ICONS[s.icon]}</div>
            <div className="wf-card">
              <b>{s.t}</b>
              <p>{s.d}</p>
              <span className="wf-tag">{s.tag}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="wf-legend">
        <span>
          <i className="wf-dot" /> the happy path
        </span>
        <span>
          <i className="wf-dot wf-dot-alert" /> where Surety steps in
        </span>
        <span>
          <i className="wf-dot wf-dot-end" /> money back to the policyholder
        </span>
      </div>
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
    ["Enforcement defines the max loss", "The rules in ENS are the numbers the hook enforces and the oracle checks."],
    ["Priced from that enforcement", "Tighter rules unlock a cheaper tier, computed live."],
    ["A human the agent can't forge", "A fresh World ID proof gates every single payout."],
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

const SLIDES: { title: string; render: () => ReactNode }[] = [
  { title: "Surety", render: () => <Intro /> },
  { title: "The numbers", render: () => <Stats /> },
  { title: "The problem", render: () => <Problem /> },
  { title: "The solution", render: () => <Solution /> },
  { title: "Workflow", render: () => <Workflow /> },
  { title: "Why it's unique", render: () => <Unique /> },
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
