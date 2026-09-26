"use client";

import { useState } from "react";

// Understated "powered by <sponsor>" attribution, wherever a sponsor's tech does real work:
// ENS (the policy is the name), World (the human checkpoint), Uniswap (enforcement + reserve).
// Grayscale and half-opacity, warming on hover.

export type Sponsor = "ens" | "world" | "uniswap";

const LOGOS: Record<Sponsor, { src: string; alt: string; h: number; name: string }> = {
  ens: { src: "/logos/ens.svg", alt: "ENS", h: 15, name: "ENSv2" },
  world: { src: "/logos/world.svg", alt: "World", h: 15, name: "World ID" },
  uniswap: { src: "/logos/uniswap.png", alt: "Uniswap", h: 15, name: "Uniswap v4" },
};

export function PoweredBy({ sponsor, label = "powered by" }: { sponsor: Sponsor; label?: string | null }) {
  const [hover, setHover] = useState(false);
  const l = LOGOS[sponsor];
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        opacity: hover ? 1 : 0.55,
        transition: "opacity .25s",
        userSelect: "none",
        verticalAlign: "middle",
      }}
    >
      {label && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={l.src}
        alt={l.alt}
        height={l.h}
        style={{ height: l.h, width: "auto", filter: hover ? "grayscale(0)" : "grayscale(1)", transition: "filter .25s" }}
      />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "var(--muted)" }}>{l.name}</span>
    </span>
  );
}
