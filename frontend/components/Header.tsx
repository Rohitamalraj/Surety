"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { Wordmark } from "./Wordmark";
import { useHealth } from "@/lib/hooks";
import { short } from "@/lib/format";

const NAV: [string, string][] = [
  ["/create", "Create policy"],
  ["/demo", "Attack replay"],
  ["/policy", "Policies"],
  ["/feed", "Feed"],
];

// Sticky, translucent bar over the paper grain — same construction as the reference header:
// pixel wordmark, mono uppercase nav, network status + wallet on the right.
export function Header() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        padding: "10px 24px",
        borderBottom: "1px solid var(--line)",
        background: "color-mix(in oklch, var(--bg) 80%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Link href="/" style={{ marginRight: 8 }}>
        <Wordmark />
      </Link>
      <nav style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {NAV.map(([href, label]) => {
          const on = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className="link label" style={{ fontSize: 11, color: on ? "var(--ink)" : undefined }}>
              {on && <span style={{ color: "var(--signal)" }}>▸ </span>}
              {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <NetworkBadge />
        {mounted ? <WalletButton /> : <span className="label flick">wallet…</span>}
      </div>
    </header>
  );
}

function NetworkBadge() {
  const { data, isError, isLoading } = useHealth();
  if (isLoading) {
    return (
      <span className="label flick" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px" }}>
        ● network…
      </span>
    );
  }
  const online = !!data && !isError;
  const net = data?.network ?? "offline";
  return (
    <span
      className="label"
      title={online ? `backend online · block ${data?.block ?? "?"}` : "backend unreachable — start it with npm run dev:local"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--radius)",
        padding: "5px 10px",
        color: online ? "var(--ink)" : "var(--loss)",
      }}
    >
      <span style={{ color: online ? "var(--gain)" : "var(--loss)" }}>●</span>
      {net}
      {online && data?.block && <span className="tnum" style={{ color: "var(--faint)" }}>#{data.block}</span>}
    </span>
  );
}

function WalletButton() {
  const { address, isConnected } = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();

  const btn: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    border: "1px solid var(--ink)",
    borderRadius: "var(--radius)",
    padding: "6px 12px",
    cursor: "pointer",
    transition: "color .2s, border-color .2s, background .2s",
  };

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect.mutate()}
        title="disconnect"
        style={{ ...btn, background: "transparent", color: "var(--ink)", borderColor: "var(--line-strong)" }}
      >
        <span style={{ color: "var(--gain)" }}>● </span>
        <span className="tnum">{short(address)}</span>
      </button>
    );
  }
  const injected = connect.connectors[0];
  return (
    <button
      disabled={!injected || connect.isPending}
      onClick={() => injected && connect.mutate({ connector: injected })}
      style={{ ...btn, background: "var(--ink)", color: "var(--bg)" }}
    >
      {connect.isPending ? "connecting…" : "Connect wallet"}
    </button>
  );
}
