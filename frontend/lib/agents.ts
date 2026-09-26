/**
 * Agent profiles for the catalog. Surety doesn't run agents — you bring your own. A profile is the
 * kind of job an agent does, what typically goes wrong, and rules that bound its worst case; picking
 * one pre-fills the Insure form (`/insure?type=<key>`). Numbers respect the on-chain tier bounds
 * (PricingEngine.satisfiesTierBounds): tier 2 needs cap ≤ 5% of coverage + an allowlist, tier 1 ≤ 20%.
 */
export interface AgentProfile {
  key: string;
  name: string;
  tagline: string;
  does: string;
  risks: string[];
  /** Who belongs on the counterparty allowlist. */
  allowlistHint: string;
  coverage: number;
  cap: number;
  tier: 0 | 1 | 2;
  /** Suggested ENS label prefix. */
  label: string;
  /** How the Uniswap v4 hook applies: swaps are checked before they execute. */
  swaps: boolean;
}

export const AGENT_PROFILES: AgentProfile[] = [
  {
    key: "payments",
    name: "Payments agent",
    tagline: "Buys things and pays merchants on your behalf.",
    does: "Checks out, tips, settles small bills. Pays a known set of merchants in small amounts.",
    risks: ["Prompt-injected into paying a new address", "Overspends in one go"],
    allowlistHint: "the merchants it's allowed to pay",
    coverage: 100,
    cap: 5,
    tier: 2,
    label: "pay",
    swaps: false,
  },
  {
    key: "trading",
    name: "Trading agent",
    tagline: "Swaps tokens on Uniswap v4 through its vault.",
    does: "Rebalances and trades USDC through the Surety pool. Every swap passes the v4 hook before it executes.",
    risks: ["“Send everything to the new address” manipulation", "One oversized trade drains the book"],
    allowlistHint: "the recipients and venues it may trade with",
    coverage: 500,
    cap: 25,
    tier: 2,
    label: "trader",
    swaps: true,
  },
  {
    key: "invoice",
    name: "Invoice agent",
    tagline: "Reads invoices and pays vendors.",
    does: "Matches invoices to purchase orders and pays approved vendors on schedule.",
    risks: ["Fake invoice or “our bank details changed” fraud", "Paying the same invoice twice"],
    allowlistHint: "your approved vendors' payout addresses",
    coverage: 1000,
    cap: 50,
    tier: 2,
    label: "invoices",
    swaps: false,
  },
  {
    key: "payroll",
    name: "Payroll agent",
    tagline: "Runs recurring payouts to a fixed team.",
    does: "Sends salaries and contractor payments to a known list, on a schedule.",
    risks: ["A payee address swapped at the last minute", "A duplicated run"],
    allowlistHint: "every employee and contractor address",
    coverage: 2000,
    cap: 100,
    tier: 2,
    label: "payroll",
    swaps: false,
  },
  {
    key: "treasury",
    name: "Treasury agent",
    tagline: "Moves funds between your own wallets and protocols.",
    does: "Sweeps idle balances, tops up hot wallets and rebalances across your accounts. Larger moves, looser rules.",
    risks: ["Funds routed out of your own accounts", "A runaway rebalance loop"],
    allowlistHint: "your own wallets (optional at this tier)",
    coverage: 5000,
    cap: 1000,
    tier: 1,
    label: "treasury",
    swaps: true,
  },
  {
    key: "api-spend",
    name: "API spend agent",
    tagline: "Pays per call for APIs, data and compute.",
    does: "Makes many tiny payments for inference, data feeds and compute, typically to a handful of providers.",
    risks: ["A retry loop that never stops paying", "A spoofed provider endpoint"],
    allowlistHint: "the providers it pays",
    coverage: 50,
    cap: 1,
    tier: 2,
    label: "api",
    swaps: false,
  },
];

export const profileByKey = (key: string | null | undefined) => AGENT_PROFILES.find((p) => p.key === key);
