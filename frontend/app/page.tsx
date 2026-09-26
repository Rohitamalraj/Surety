"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InteractiveDither } from "@/components/InteractiveDither";
import { DitherArt } from "@/components/DitherArt";
import { PoweredBy } from "@/components/PoweredBy";
import { Wordmark } from "@/components/Wordmark";
import { Footer } from "@/components/Footer";

const MECHANISM = [
  {
    n: "01",
    k: "ENFORCE",
    t: "Rules the agent can't argue with.",
    shape: "arrows" as const,
    d: "The agent's ENS name publishes its rules: a per-transaction cap and a counterparty allowlist. A Uniswap v4 hook reverts any swap that breaks them. The Grok-style attack never executes.",
  },
  {
    n: "02",
    k: "RECORD",
    t: "Violations anyone can recompute.",
    shape: "signal" as const,
    d: "A transfer that slips through is recorded on-chain. Over the cap or off the allowlist is arithmetic on public data. No oracle, no adjuster, re-run the check yourself.",
  },
  {
    n: "03",
    k: "PAYOUT",
    t: "A fresh human, then the money.",
    shape: "loop" as const,
    d: "The policyholder re-verifies with World ID: the same human who bought it, right now. The shared reserve pays in minutes. Cancel, and the claim is held, never paid.",
  },
];

type Sponsor = "ens" | "world" | "uniswap";

// Hovering a sponsor logo takes over the hero with why that layer is load-bearing,
// not decoration. DEFAULT shows when nothing is hovered.
interface HeroCopy {
  heading: string;
  eyebrow: string;
  body: string;
}
const DEFAULT: HeroCopy = {
  heading: "INSURE THE AGENT.",
  eyebrow: "// built on",
  body:
    "Parametric insurance for AI agents that spend money. When an insured agent breaks its own published rules, the payout is a contract call. No adjuster, no lawsuit, same day.",
};
const SPONSOR_COPY: Record<Sponsor, HeroCopy> = {
  ens: {
    heading: "THE RULES ARE THE NAME.",
    eyebrow: "// why ENSv2",
    body:
      "Every policy is a non-transferable ENS name whose records are the rules: cap, allowlist, coverage. Any counterparty reads them with zero integration, and the agent's own key can edit exactly one field, its clean streak.",
  },
  world: {
    heading: "PROVE WHO'S ASKING.",
    eyebrow: "// why World ID",
    body:
      "A wallet signature only proves someone holds a key, which is exactly what a hijacked agent has. Buying takes a unique human. Every payout takes a fresh World ID check by the same human who bought the policy.",
  },
  uniswap: {
    heading: "THE POOL HOLDS THE LINE.",
    eyebrow: "// why Uniswap v4",
    body:
      "A v4 hook checks every agent swap against the published rules before it executes, and custodies the shared reserve that pays verified claims. Enforcement and the money live in the same place.",
  },
};

const SPONSOR_LOGOS: { key: Sponsor; title: string; src: string; w: number; h: number }[] = [
  { key: "ens", title: "ENS", src: "/logos/ens.svg", w: 46, h: 54 },
  { key: "world", title: "World", src: "/logos/world.svg", w: 52, h: 52 },
  { key: "uniswap", title: "Uniswap", src: "/logos/uniswap.png", w: 52, h: 54 },
];

// Types `text` in whenever it changes (on hover), with a blinking caret. First render shows it whole.
function Typewriter({ text, speed = 34 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return (
    <>
      {shown}
      <span className="tw-caret" aria-hidden />
    </>
  );
}

const cellHead = (n: string, k: string) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
    <span className="pixel" style={{ fontSize: 22, color: "var(--faint)" }}>
      {n}
    </span>
    <span className="label">{k}</span>
  </div>
);

export default function HomePage() {
  const [hovered, setHovered] = useState<Sponsor | null>(null);
  const active = hovered ? SPONSOR_COPY[hovered] : DEFAULT;
  const swapKey = hovered ?? "default";

  return (
    <main>
      {/* ---- HERO ---- */}
      <section className="relative overflow-hidden" style={{ minHeight: "min(92vh, 900px)", borderBottom: "1px solid var(--line)" }}>
        <InteractiveDither className="absolute inset-0 h-full w-full" />
        <div
          className="absolute inset-0"
          style={{
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, color-mix(in oklch, var(--bg) 82%, transparent) 0%, color-mix(in oklch, var(--bg) 42%, transparent) 34%, transparent 68%), linear-gradient(0deg, var(--bg), transparent 26%), linear-gradient(180deg, color-mix(in oklch, var(--bg) 45%, transparent), transparent 14%)",
          }}
        />
        <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-6" style={{ minHeight: "min(92vh, 900px)" }}>
          <div className="rise" style={{ animationDelay: "0ms" }}>
            <Wordmark size={18} caret />
          </div>

          <h1
            className="rise"
            style={{
              animationDelay: "80ms",
              fontSize: "clamp(44px, 9vw, 116px)",
              margin: "18px 0 0",
              lineHeight: 0.94,
              minHeight: "1.88em",
              maxWidth: "16ch",
            }}
          >
            <Typewriter text={active.heading} />
          </h1>

          <p
            className="rise"
            style={{
              animationDelay: "180ms",
              maxWidth: "56ch",
              marginTop: 22,
              minHeight: "5.4em",
              color: hovered ? "var(--ink)" : "var(--muted)",
              fontSize: 15,
              lineHeight: 1.6,
              transition: "color 0.2s var(--ease-out-quart)",
            }}
          >
            <span key={swapKey} className="hero-swap">
              {active.body}
            </span>
          </p>

          <div className="rise" style={{ animationDelay: "250ms", marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href="/demo"
              className="hero-ext"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 13px 7px 11px",
                border: "1px solid var(--line-strong)",
                borderRadius: 999,
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              <span aria-hidden style={{ color: "var(--signal)", fontSize: 13 }}>
                ◇
              </span>
              <span>watch the attack replay · live on-chain</span>
              <span aria-hidden style={{ color: "var(--faint)" }}>
                ↗
              </span>
            </Link>
            <Link
              href="/create"
              className="hero-ext"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 13px",
                border: "1px solid var(--ink)",
                borderRadius: 999,
                fontSize: 12,
                color: "var(--bg)",
                background: "var(--ink)",
              }}
            >
              insure an agent →
            </Link>
          </div>

          <div className="rise" style={{ animationDelay: "360ms", marginTop: 30 }}>
            <div className="label" style={{ marginBottom: 14, color: hovered ? "var(--ink)" : "var(--faint)", transition: "color 0.2s" }}>
              <span key={swapKey} className="hero-swap">
                {active.eyebrow}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap" }}>
              {SPONSOR_LOGOS.map((s) => (
                <span
                  key={s.key}
                  className="sponsor"
                  title={s.title}
                  onMouseEnter={() => setHovered(s.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    width: s.w,
                    height: s.h,
                    cursor: "pointer",
                    WebkitMaskImage: `url(${s.src})`,
                    maskImage: `url(${s.src})`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="label" style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", zIndex: 10 }}>
          ↓ scroll to the mechanism
        </div>
      </section>

      {/* ---- MECHANISM ---- */}
      <section className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(64px, 12vw, 140px) 24px" }}>
        <div className="label" style={{ marginBottom: 10 }}>
          {"// how a claim works"}
        </div>
        <h2 style={{ fontSize: "clamp(28px, 5vw, 52px)", maxWidth: "18ch" }}>Paid by evidence, never by argument.</h2>
        <div
          style={{
            marginTop: 56,
            display: "grid",
            gap: 1,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            background: "var(--line)",
            border: "1px solid var(--line)",
          }}
        >
          {MECHANISM.map((e) => (
            <div key={e.n} className="scan" style={{ background: "var(--bg)", padding: "28px 26px 34px" }}>
              {cellHead(e.n, e.k)}
              <div style={{ marginTop: 20, height: 150, background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                <DitherArt shape={e.shape} invert gap={4} className="h-full w-full" />
              </div>
              <h3 style={{ fontSize: 22, marginTop: 22 }}>{e.t}</h3>
              <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7 }}>{e.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- WHY IT EXISTS (bento) ---- */}
      <section className="mx-auto max-w-6xl px-6" style={{ padding: "0 24px clamp(72px, 12vw, 140px)" }}>
        <div className="label" style={{ marginBottom: 10 }}>
          {"// why it exists"}
        </div>
        <h2 style={{ fontSize: "clamp(28px, 5vw, 52px)", maxWidth: "20ch" }}>The losses standard policies stopped covering.</h2>

        <div className="bento" style={{ marginTop: 56 }}>
          {/* 01 — the incident */}
          <div className="bento-cell bento-lg scan">
            {cellHead("01", "real incident · may 4, 2026")}
            <div
              style={{
                flex: 1,
                minHeight: 200,
                marginTop: 22,
                background: "var(--dark)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <DitherArt shape="hand" invert gap={4} className="h-full w-full" />
              <div
                className="label"
                style={{ position: "absolute", left: 16, top: 14, right: 16, color: "var(--dark-ink)", opacity: 0.8 }}
              >
                ·- -··· ·· ·-·· ·-·· — a morse-coded instruction, and the agent obeyed
              </div>
            </div>
            <h3 style={{ fontSize: 26, marginTop: 24 }}>$150K gone to one message.</h3>
            <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 14, lineHeight: 1.7, maxWidth: "50ch" }}>
              An attacker gifted Grok&apos;s Bankr wallet an NFT that unlocked elevated permissions, then a Morse-coded message
              talked the agent into sending roughly $150–200K. A safety block had stopped the same trick before. It didn&apos;t
              survive a code rewrite.
            </p>
            <div className="bento-flag">
              <span className="db-mark" style={{ textDecoration: "line-through" }}>
                COVERED
              </span>
              <span className="label" style={{ color: "var(--loss)" }}>
                AI losses excluded from ISO forms since jan 1, 2026
              </span>
            </div>
          </div>

          {/* 02 — priced live */}
          <div className="bento-cell bento-sm scan">
            {cellHead("02", "priced live")}
            <h3 style={{ fontSize: 21, marginTop: 20 }}>A premium you can read.</h3>
            <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7 }}>
              A credibility-weighted claim frequency, a tier from how tight the rules are, a discount for a clean streak. Every
              term computed on screen, nothing guessed.
            </p>
            <div style={{ marginTop: "auto", paddingTop: 18 }}>
              <PoweredBy sponsor="ens" label="rules on" />
            </div>
          </div>

          {/* 03 — one human one wallet */}
          <div className="bento-cell bento-sm scan">
            {cellHead("03", "one human, one wallet")}
            <h3 style={{ fontSize: 21, marginTop: 20 }}>No Sybil farming the pool.</h3>
            <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.7 }}>
              Before buying, the policyholder proves they&apos;re a unique human. One person can&apos;t spin up a hundred wallets
              and a hundred claims against the shared reserve.
            </p>
            <div style={{ marginTop: "auto", paddingTop: 18 }}>
              <PoweredBy sponsor="world" />
            </div>
          </div>

          {/* 04 — enforce / insure */}
          <div className="bento-cell bento-wide scan" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 340px", padding: "28px 26px 30px", display: "flex", flexDirection: "column" }}>
                {cellHead("04", "enforce / insure")}
                <h3 style={{ fontSize: 24, marginTop: 20 }}>Enforce where you can. Insure what gets through.</h3>
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 14, lineHeight: 1.7, maxWidth: "56ch" }}>
                  Swaps through the pool are{" "}
                  <em style={{ fontStyle: "normal", color: "var(--gain)" }}>blocked</em> before they execute. Transfers that break
                  the rules are <em style={{ fontStyle: "normal", color: "var(--loss)" }}>recorded</em>, and a verified claim is paid
                  from the reserve in the same afternoon.
                </p>
                <div style={{ marginTop: "auto", paddingTop: 18 }}>
                  <PoweredBy sponsor="uniswap" />
                </div>
              </div>
              <div style={{ flex: "1 1 300px", minHeight: 220, background: "var(--dark)", overflow: "hidden" }}>
                <DitherArt shape="arrows" invert gap={4} className="h-full w-full" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- CTA ---- */}
      <section className="mx-auto max-w-6xl px-6" style={{ padding: "0 24px clamp(48px, 8vw, 90px)" }}>
        <Link
          href="/create"
          className="scan"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            padding: "18px 22px",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            color: "var(--ink)",
          }}
        >
          <span className="label" style={{ color: "var(--ink)" }}>
            ◇ insure your agent · premium quoted live, term by term
          </span>
          <span className="label" style={{ color: "var(--faint)" }}>
            create a policy ↗
          </span>
        </Link>
      </section>

      <Footer />
    </main>
  );
}
