"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { normalize } from "viem/ens";
import type { Address } from "viem";
import { ENS_APP, ENS_EXPLORER, ENS_PARENT } from "@/lib/config";
import { addrUrl, short } from "@/lib/format";

/**
 * The policy is an ENS name: show its structure (subname under surety.eth) and where anyone can
 * verify it outside Surety — ENS's own Explorer and App (ENSv2 beta), the resolver contract on
 * Etherscan, and Surety's public lookup page.
 */
export function EnsVerify({ label, resolver: known, lookup = true }: { label: string; resolver?: Address | null; lookup?: boolean }) {
  const name = `${label}.${ENS_PARENT}`;
  const client = usePublicClient();
  const fetched = useQuery({
    queryKey: ["ensResolver", name],
    queryFn: () => client!.getEnsResolver({ name: normalize(name) }),
    enabled: !known && !!client,
    staleTime: 60_000,
    retry: 0,
  });
  const resolver = known ?? fetched.data ?? null;

  const links: { href: string; text: string; sub: string; internal?: boolean }[] = [];
  if (ENS_EXPLORER) {
    links.push({ href: `${ENS_EXPLORER}/${name}`, text: "ENS Explorer", sub: "owner, parent, records, history" });
    links.push({ href: `${ENS_EXPLORER}/${name}/resolver`, text: "Resolver on ENS Explorer", sub: "official Permissioned Resolver" });
  }
  if (ENS_APP) links.push({ href: `${ENS_APP}/${name}`, text: "ENS App", sub: "name → AgentVault address" });
  const resolverUrl = resolver ? addrUrl(resolver) : null;
  if (resolverUrl) links.push({ href: resolverUrl, text: "Resolver contract", sub: `${short(resolver!)} on Etherscan` });
  if (ENS_EXPLORER) links.push({ href: `${ENS_EXPLORER}/${ENS_PARENT}`, text: `Parent ${ENS_PARENT}`, sub: "every policy is a subname of it" });
  if (lookup) links.push({ href: `/policy/${label}`, text: "Surety lookup", sub: "public policy page", internal: true });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="label">verify on ENS</div>
      <div className="tnum" style={{ fontSize: 15, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 0 }}>
        <span style={{ color: "var(--signal)", fontWeight: 600 }}>{label}</span>
        <span style={{ color: "var(--muted)" }}>.{ENS_PARENT}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
        <span className="label">subname</span>
        <span className="tnum">{label}</span>
        <span className="label">parent</span>
        <span className="tnum">{ENS_PARENT}</span>
        <span className="label">protocol</span>
        <span>ENSv2 · non-transferable</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
        {links.map((l) => {
          const body = (
            <>
              <span style={{ fontSize: 13, color: "var(--ink)" }}>{l.text}</span>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>
                {l.sub} {l.internal ? "→" : "↗"}
              </span>
            </>
          );
          const style = {
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "baseline",
            flexWrap: "wrap" as const,
            padding: "7px 0",
            borderBottom: "1px solid var(--line)",
          };
          return l.internal ? (
            <Link key={l.href} href={l.href} className="link" style={style}>
              {body}
            </Link>
          ) : (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="link" style={style}>
              {body}
            </a>
          );
        })}
      </div>
    </div>
  );
}
