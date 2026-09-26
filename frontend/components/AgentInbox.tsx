"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type InboxMessage } from "@/lib/api";
import { ago } from "@/lib/format";

/**
 * The agent's public inbox, exactly as the model reads it through `read_inbox`. Anyone can write to
 * it — which is why an attacker's email can reach the agent at all.
 */
export function AgentInbox({ node, compact = false }: { node: string; compact?: boolean }) {
  const inbox = useQuery({ queryKey: ["agentInbox", node], queryFn: () => api.agentInboxList(node), refetchInterval: 4_000, retry: 0 });
  const list = [...(inbox.data ?? [])].reverse();

  return (
    <div className="side-card ens-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="label">agent inbox · public · what the model reads</span>
        <span className="label">
          {list.length} message{list.length === 1 ? "" : "s"}
        </span>
      </div>
      {inbox.isLoading && <div className="label flick">loading…</div>}
      {inbox.data && list.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Empty. Anyone can email this agent; nothing has arrived yet.</div>
      )}
      {list.slice(0, compact ? 3 : 10).map((m, i) => (
        <Message key={m.id} m={m} open={i === 0} />
      ))}
    </div>
  );
}

function Message({ m, open: initiallyOpen }: { m: InboxMessage; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "10px 12px",
          background: "var(--surface-2)",
          border: 0,
          cursor: "pointer",
          color: "var(--ink)",
        }}
      >
        <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{m.subject}</span>
          <span className="label" style={{ whiteSpace: "nowrap" }}>
            {m.read ? "read by agent ✓" : "unread"} · {ago(m.receivedAt)}
          </span>
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>from {m.from}</span>
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: "12px",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--ink)",
            background: "var(--surface)",
          }}
        >
          {m.body}
        </pre>
      )}
    </div>
  );
}
