"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFeed } from "@/lib/hooks";
import { ENS_PARENT } from "@/lib/config";
import { ago, short, usdc } from "@/lib/format";
import { DitherArt } from "@/components/DitherArt";
import { PageHead } from "@/components/ui";

/** Counterparty lookup (PRD US-12): anyone can check an agent's coverage by its ENS name. */
export default function PolicyLookupPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const demo = useQuery({ queryKey: ["demo"], queryFn: api.demo, retry: 0 });
  const feed = useFeed();
  const issued = (feed.data ?? []).filter((e) => e.type === "PolicyIssued");

  const go = (v: string) => {
    const s = v.trim().replace(new RegExp(`\\.${ENS_PARENT.replace(".", "\\.")}$`), "");
    if (s) router.push(`/policy/${encodeURIComponent(s)}`);
  };

  return (
    <main className="mx-auto max-w-5xl px-6" style={{ padding: "clamp(48px, 10vw, 110px) 24px 100px" }}>
      <PageHead label="// counterparty lookup" title="Is this agent insured?">
        Every Surety policy is an ENS name. Look one up to see its published rules, what it has paid, and every claim, with
        zero custom integration.
      </PageHead>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        style={{ marginTop: 28, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <div className="term-search" style={{ flex: "1 1 320px" }}>
          <span className="label">◎</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`agent name, e.g. agent1 → agent1.${ENS_PARENT}`} />
          <span className="label">.{ENS_PARENT}</span>
        </div>
        <button className="btn btn-primary" type="submit">
          Look up
        </button>
      </form>

      <div style={{ position: "relative", height: 110, marginTop: 28, background: "var(--dark)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <DitherArt shape="loop" invert gap={4} className="h-full w-full" />
        <div className="label" style={{ position: "absolute", bottom: 12, left: 16, right: 16, color: "var(--dark-ink)", opacity: 0.8 }}>
          the rules are public · resolver looked up fresh on every read
        </div>
      </div>

      {demo.data && (
        <Link
          href={`/policy/${demo.data.node}`}
          className="wl-row"
          style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "16px 6px", borderBottom: "1px solid var(--line)", marginTop: 20 }}
        >
          <span>
            <span className="pixel" style={{ color: "var(--signal)", marginRight: 12 }}>
              ◆
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
              {demo.data.label}.{ENS_PARENT}
            </span>
            <span className="label" style={{ marginLeft: 12 }}>
              demo policy
            </span>
          </span>
          <span className="label">open →</span>
        </Link>
      )}

      <div className="label" style={{ marginTop: 32, marginBottom: 6 }}>
        {"// recently issued"}
      </div>
      {issued.length === 0 && <div className="label" style={{ padding: "18px 0", color: "var(--muted)" }}>no policies issued on this network yet.</div>}
      {issued.map((e) => (
        <Link
          key={e.id}
          href={`/policy/${e.node}`}
          className="wl-row"
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 16, padding: "14px 6px", borderBottom: "1px solid var(--line)" }}
        >
          <span className="tnum" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {short(e.node, 10, 8)}
          </span>
          <span className="tnum" style={{ color: "var(--muted)" }}>
            {usdc(String(e.data.coverageLimit), 0)} USDC
          </span>
          <span className="label">{ago(e.timestamp)}</span>
        </Link>
      ))}
    </main>
  );
}
