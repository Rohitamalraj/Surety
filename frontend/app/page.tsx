"use client";

import Link from "next/link";
import Globe, { type GlobeMarker } from "@/components/lightswind/globe";
import { LineArt } from "@/components/LineArt";
import { PoweredBy } from "@/components/PoweredBy";
import { Wordmark } from "@/components/Wordmark";
import { Footer } from "@/components/Footer";
import MaskedHeading from "@/components/MaskedHeading";
import { useTheme } from "@/lib/theme";

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

const HERO = {
  heading: "INSURE THE ON-CHAIN AGENTS",
  body:
    "Parametric insurance for AI agents that spend money. When an insured agent breaks its own published rules, the payout is a contract call. No adjuster, no lawsuit, same day.",
};

const SPONSOR_LOGOS: { key: string; title: string; src: string }[] = [
  { key: "ens", title: "ENSv2", src: "/logos/ens.svg" },
  { key: "world", title: "World ID", src: "/logos/world.svg" },
  { key: "uniswap", title: "Uniswap v4", src: "/logos/uniswap.png" },
];

// No markers: the globe is illustration only — it does not claim where insured agents are.
const NO_MARKERS: GlobeMarker[] = [];

const cellHead = (n: string, k: string) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
    <span className="pixel" style={{ fontSize: 22, color: "var(--faint)" }}>
      {n}
    </span>
    <span className="label">{k}</span>
  </div>
);

export default function HomePage() {
  const dark = useTheme() === "dark";

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

            <MaskedHeading
              tag="h1"
              text={HERO.heading}
              src="/hero-fill.svg"
              reveal="rise"
              trigger="mount"
              align="left"
              weight={800}
              tracking={-0.02}
              lineHeight={0.96}
              textScale={0.13}
              fillScale={1.25}
              drift={18}
              parallax={26}
              duration={1.1}
              stagger={0.09}
              style={{ marginTop: 22, fontFamily: "var(--font-display), sans-serif" }}
            />

            <p
              className="rise"
              style={{
                animationDelay: "180ms",
                maxWidth: "52ch",
                marginTop: 22,
                minHeight: "6.4em",
                color: "var(--muted)",
                fontSize: 15,
                lineHeight: 1.65,
              }}
            >
              {HERO.body}
            </p>

            <div className="rise" style={{ animationDelay: "250ms", marginTop: 26, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/agents" className="btn btn-signal" style={{ borderRadius: 999, padding: "12px 20px" }}>
                Insure an agent →
              </Link>
              <Link href="/demo" className="btn" style={{ borderRadius: 999, padding: "12px 20px", background: "var(--surface)" }}>
                Watch the attack replay
              </Link>
            </div>

            <div className="rise" style={{ animationDelay: "360ms", marginTop: 34 }}>
              <div className="label" style={{ marginBottom: 12, color: "var(--faint)" }}>
                built on
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {SPONSOR_LOGOS.map((s) => (
                  <span
                    key={s.key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px 9px 12px",
                      borderRadius: 999,
                      border: "1px solid var(--line)",
                      background: "var(--surface)",
                    }}
                  >
                    <span
                      className="sponsor sponsor-static"
                      style={{ width: 20, height: 20, WebkitMaskImage: `url(${s.src})`, maskImage: `url(${s.src})` }}
                    />
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{s.title}</span>
                  </span>
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
              dark={dark ? 1 : 0}
              scale={1}
              diffuse={1.1}
              mapSamples={20000}
              mapBrightness={dark ? 6 : 3.2}
              baseColor={dark ? "#27365f" : "#c7d7ff"}
              markerColor={dark ? "#7aa2ff" : "#2f6bff"}
              glowColor={dark ? "#1f2d57" : "#dbe6ff"}
              markers={NO_MARKERS}
              enableZoom={false}
              autoRotateSpeed={0.0035}
            />
            <div
              className="label"
              style={{ position: "absolute", left: 0, right: 0, bottom: 6, textAlign: "center" }}
            >
              drag to rotate
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
          href="/insure"
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
