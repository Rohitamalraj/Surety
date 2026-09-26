import Link from "next/link";
import type { FeedEvent } from "@/lib/api";
import { ago, short, usdc } from "@/lib/format";
import { TxLink, VIOLATION_TEXT } from "./ui";

const VTYPES = ["None", "CapBreach", "OffAllowlist", "Attested"];

/** One public event, in plain words. Every row links to its transaction. */
export function describe(e: FeedEvent): { glyph: string; tone: "ink" | "gain" | "loss" | "muted"; text: string } {
  const d = e.data;
  switch (e.type) {
    case "PolicyIssued":
      return { glyph: "◆", tone: "ink", text: `Policy issued · coverage ${usdc(String(d.coverageLimit), 0)} · cap ${usdc(String(d.perTxCap), 0)} · premium ${usdc(String(d.premium))}` };
    case "PremiumDeposited":
      return { glyph: "+", tone: "muted", text: `Premium into the reserve · ${usdc(String(d.amount))}` };
    case "BackingDeposited":
      return { glyph: "+", tone: "muted", text: `Backer ${short(String(d.backer))} funded the reserve · ${usdc(String(d.amount))}` };
    case "Deposited":
      return { glyph: "+", tone: "muted", text: `Agent funds deposited · ${usdc(String(d.amount))}` };
    case "PaymentMade":
      return { glyph: "→", tone: "muted", text: `Agent paid ${short(String(d.to))} · ${usdc(String(d.amount))} · payment #${e.paymentId}` };
    case "SwapExecuted":
      return { glyph: "⇄", tone: "muted", text: `Agent swap within policy · ${usdc(String(d.amountIn))}` };
    case "ClaimFiled":
      return {
        glyph: "!",
        tone: "loss",
        text: `Claim #${e.claimId} filed · ${VIOLATION_TEXT[VTYPES[Number(d.vtype)]] ?? "violation"} · ${usdc(String(d.amount))}`,
      };
    case "ClaimHeld":
      return { glyph: "‖", tone: "loss", text: `Claim #${e.claimId} held · ${String(d.reason)}` };
    case "ClaimApproved":
      return { glyph: "✓", tone: "ink", text: `Claim #${e.claimId} · fresh World ID verified` };
    case "ClaimPaid":
      return { glyph: "$", tone: "gain", text: `Claim #${e.claimId} paid · ${usdc(String(d.amount))} to ${short(String(d.to))}` };
    case "PayoutReleased":
      return { glyph: "$", tone: "gain", text: `Reserve released ${usdc(String(d.amount))} for claim #${e.claimId}` };
    case "ClaimRejected":
      return { glyph: "✕", tone: "loss", text: `Claim #${e.claimId} rejected · ${String(d.reason)}` };
    case "HumanVerified":
      return { glyph: "◎", tone: "ink", text: `Unique human verified for ${short(String(d.wallet))}` };
    case "StreakUpdated":
      return { glyph: "↑", tone: "muted", text: `Clean streak now ${String(d.streak)}` };
    case "PolicyExhausted":
      return { glyph: "■", tone: "loss", text: "Coverage exhausted" };
    default:
      return { glyph: "·", tone: "muted", text: e.type };
  }
}

const TONE = { ink: "var(--ink)", gain: "var(--gain)", loss: "var(--loss)", muted: "var(--muted)" };

export function EventRow({ e, showNode = true }: { e: FeedEvent; showNode?: boolean }) {
  const { glyph, tone, text } = describe(e);
  return (
    <div className="event-row">
      <span className="event-glyph" style={{ color: TONE[tone] }}>
        {glyph}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: tone === "muted" ? "var(--ink)" : TONE[tone], fontSize: 13 }}>{text}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 3 }}>
          <span className="label">{e.contract}</span>
          {showNode && e.node && (
            <Link href={`/policy/${e.node}`} className="link label" style={{ textTransform: "none", letterSpacing: 0 }}>
              {short(e.node, 8, 6)}
            </Link>
          )}
          <TxLink hash={e.txHash} />
        </div>
      </div>
      <span className="label tnum" style={{ whiteSpace: "nowrap" }}>
        {ago(e.timestamp)}
      </span>
    </div>
  );
}
