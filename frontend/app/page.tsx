"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Globe, { type GlobeMarker } from "@/components/lightswind/globe";
import { LineArt } from "@/components/LineArt";
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
  heading: "Insure the agent.",
  eyebrow: "built on",
  body:
    "Parametric insurance for AI agents that spend money. When an insured agent breaks its own published rules, the payout is a contract call. No adjuster, no lawsuit, same day.",
};
const SPONSOR_COPY: Record<Sponsor, HeroCopy> = {
  ens: {
    heading: "The rules are the name.",
    eyebrow: "why ENSv2",
    body:
      "Every policy is a non-transferable ENS name whose records are the rules: cap, allowlist, coverage. Any counterparty reads them with zero integration, and the agent's own key can edit exactly one field, its clean streak.",
  },
  world: {
    heading: "Prove who's asking.",
    eyebrow: "why World ID",
    body:
      "A wallet signature only proves someone holds a key, which is exactly what a hijacked agent has. Buying takes a unique human. Every payout takes a fresh World ID check by the same human who bought the policy.",
  },
  uniswap: {
    heading: "The pool holds the line.",
    eyebrow: "why Uniswap v4",
    body:
      "A v4 hook checks every agent swap against the published rules before it executes, and custodies the shared reserve that pays verified claims. Enforcement and the money live in the same place.",
  },
};

const SPONSOR_LOGOS: { key: Sponsor; title: string; src: string }[] = [
  { key: "ens", title: "ENSv2", src: "/logos/ens.svg" },
  { key: "world", title: "World ID", src: "/logos/world.svg" },
  { key: "uniswap", title: "Uniswap v4", src: "/logos/uniswap.png" },
];

// Insured agents transacting around the world (stable reference so the globe isn't rebuilt).
const AGENT_MARKERS: GlobeMarker[] = [
  { location: [35.68, 139.69], size: 0.09 }, // Tokyo
  { location: [37.77, -122.42], size: 0.07 }, // San Francisco
  { location: [40.71, -74.0], size: 0.07 }, // New York
  { location: [51.51, -0.13], size: 0.06 }, // London
  { location: [1.35, 103.82], size: 0.06 }, // Singapore
  { location: [52.52, 13.4], size: 0.05 }, // Berlin
  { location: [12.97, 77.59], size: 0.06 }, // Bengaluru
  { location: [-23.55, -46.63], size: 0.05 }, // São Paulo
  { location: [25.2, 55.27], size: 0.05 }, // Dubai
  { location: [-33.87, 151.21], size: 0.05 }, // Sydney
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
      {/* ---- HERO: copy left, live globe right ---- */}
      <section style={{ borderBottom: "1px solid var(--line)" }}>
        <div
          className="mx-auto grid max-w-6xl items-center px-6"
          style={{ minHeight: "min(88vh, 860px)", gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)", gap: 24 }}
        >
          <div style={{ padding: "56px 0" }}>
            <span className="pill pill-live rise" style={{ animationDelay: "0ms" }}>
              <span className="pill-dot" />
              parametric cover for AI agents
            </span>

            <h1
              className="rise"
              style={{
                animationDelay: "80ms",
                fontSize: "clamp(44px, 7.2vw, 96px)",
                margin: "22px 0 0",
                lineHeight: 0.98,
                minHeight: "2em",
                maxWidth: "12ch",
                fontWeight: 800,
              }}
            >
              <Typewriter text={active.heading} />
            </h1>

            <p
              className="rise"
              style={{
                animationDelay: "180ms",
                maxWidth: "52ch",
                marginTop: 22,
                minHeight: "6.4em",
                color: hovered ? "var(--ink)" : "var(--muted)",
                fontSize: 15,
                lineHeight: 1.65,
                transition: "color 0.2s var(--ease-out-quart)",
              }}
            >
              <span key={swapKey} className="hero-swap">
                {active.body}
              </span>
            </p>

            <div className="rise" style={{ animationDelay: "250ms", marginTop: 26, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/create" className="btn btn-signal" style={{ borderRadius: 999, padding: "12px 20px" }}>
                Insure an agent →
              </Link>
              <Link href="/demo" className="btn" style={{ borderRadius: 999, padding: "12px 20px", background: "var(--surface)" }}>
                Watch the attack replay
              </Link>
            </div>

            <div className="rise" style={{ animationDelay: "360ms", marginTop: 34 }}>
              <div className="label" style={{ marginBottom: 12, color: hovered ? "var(--ink)" : "var(--faint)", transition: "color 0.2s" }}>
                <span key={swapKey} className="hero-swap">
                  {active.eyebrow} · hover to see why
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {SPONSOR_LOGOS.map((s) => (
                  <button
                    key={s.key}
                    onMouseEnter={() => setHovered(s.key)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(s.key)}
                    onBlur={() => setHovered(null)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px 9px 12px",
                      borderRadius: 999,
                      border: `1px solid ${hovered === s.key ? "var(--signal)" : "var(--line)"}`,
                      background: hovered === s.key ? "var(--signal-soft)" : "var(--surface)",
                      cursor: "pointer",
                      transition: "border-color .2s, background .2s",
                    }}
                  >
                    <span
                      className="sponsor"
                      style={{ width: 20, height: 20, WebkitMaskImage: `url(${s.src})`, maskImage: `url(${s.src})` }}
                    />
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rise" style={{ animationDelay: "200ms", position: "relative", aspectRatio: "1 / 1", maxHeight: 620 }}>
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: "8%",
                borderRadius: "50%",
                background: "radial-gradient(circle, var(--signal-soft) 0%, transparent 70%)",
              }}
            />
            <Globe
              className="h-full w-full"
              theta={0.28}
              dark={0}
              scale={1}
              diffuse={1.1}
              mapSamples={20000}
              mapBrightness={3.2}
              baseColor="#c7d7ff"
              markerColor="#2f6bff"
              glowColor="#dbe6ff"
              markers={AGENT_MARKERS}
              enableZoom={false}
              autoRotateSpeed={0.0035}
            />
            <div
              className="label"
              style={{ position: "absolute", left: 0, right: 0, bottom: 6, textAlign: "center" }}
            >
              agents insured · drag to rotate
            </div>
          </div>
        </div>
      </section>

      {/* ---- MECHANISM ---- */}
      <section className="mx-auto max-w-6xl px-6" style={{ padding: "clamp(64px, 12vw, 140px) 24px" }}>
        <div className="label" style={{ marginBottom: 10 }}>
          {"how a claim works"}
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
              <div style={{ marginTop: 20, height: 150, background: "var(--tint)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                <LineArt shape={e.shape} className="h-full w-full" />
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
          {"why it exists"}
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
                background: "var(--tint)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <LineArt shape="hand" className="h-full w-full" />
              <div
                className="label"
                style={{
                  position: "absolute",
                  left: 14,
                  top: 14,
                  zIndex: 1,
                  color: "var(--accent-ink)",
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "5px 12px",
                }}
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
              <div style={{ flex: "1 1 300px", minHeight: 220, background: "var(--tint)", overflow: "hidden" }}>
                <LineArt shape="arrows" className="h-full w-full" />
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
