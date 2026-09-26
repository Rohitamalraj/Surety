import type { IDKitResult } from "@worldcoin/idkit";
import type { Address, Hex } from "viem";
import { BACKEND_URL } from "./config";

/** Typed client for the Surety backend (backend/README.md). */

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
const post = <T>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------- types

export interface Deployments {
  network: "local" | "sepolia";
  chainId: number;
  MockUSDC?: Address;
  PolicyRegistry?: Address;
  AgentVault?: Address;
  SuretyHook?: Address;
  ViolationOracle?: Address;
  WorldIdGate?: Address;
  ClaimRouter?: Address;
  demo?: DemoInfo;
}

export interface DemoInfo {
  label: string;
  node: Hex;
  agent: Address;
  policyholder: Address;
  merchant: Address;
  attacker: Address;
  payout: Address;
}

export interface FeedEvent {
  id: string;
  type: string;
  contract: string;
  block: number;
  timestamp: number;
  txHash: Hex;
  node?: Hex;
  claimId?: string;
  paymentId?: string;
  data: Record<string, string | number | boolean>;
}

export interface PolicyRecord {
  policyholder: Address;
  agent: Address;
  payoutAddr: Address;
  coverageLimit: string;
  perTxCap: string;
  tier: number;
  streak: number;
  claimsCount: number;
  subHash: Hex;
  paidOut: string;
  issuedAt: string;
  active: boolean;
}

export type Violation = "None" | "CapBreach" | "OffAllowlist" | "Attested";
export type ClaimStatus = "None" | "Pending" | "Held" | "Paid" | "Rejected";

export interface PolicyView {
  node: Hex;
  label?: string;
  policy: PolicyRecord;
  payments: { paymentId: string; to: Address; amount: string; txHash: Hex; timestamp: number; violation: Violation }[];
  claims: { claimId: string; paymentId: string; vtype: Violation; amount: string; status: ClaimStatus; filedAt: number }[];
  events: FeedEvent[];
}

/** One row of GET /api/policies — live on-chain state plus the ENS label from the purchase tx. */
export interface PolicySummary {
  node: Hex;
  label: string | null;
  premium: string;
  issuedTx: Hex;
  issuedAt: number;
  policy: PolicyRecord;
  claims: { claimId: string; paymentId: string; amount: string; status: ClaimStatus; filedAt: number }[];
  payments: number;
}

export interface Solvency {
  liquidReserve: string;
  totalCoverage: string;
  ratio: number | null;
  required: number;
}

export type SessionStatus = "pending" | "approved" | "denied" | "expired" | "cancelled" | "mismatch";
export interface WorldIdSession {
  id: string;
  purpose: "enroll" | "claim";
  status: SessionStatus;
  address?: Address;
  claimId?: string;
  returnTo?: string;
  subHash?: Hex;
  expiry?: number;
  authTime?: number;
  sig?: Hex;
  reason?: string;
  heldTx?: Hex;
}

export interface StepResult {
  step: string;
  txHash?: Hex;
  reverted: boolean;
  revertReason?: string;
  /** attack-swap only: SuretyHook itself rejected the swap. */
  blockedByHook?: boolean;
  paymentId?: string;
  /** swap only: WETH received, wei. */
  amountOut?: string;
  amount?: string;
  to?: Address;
}

export interface IdkitConfig {
  enabled: boolean;
  app_id: `app_${string}` | null;
  rp_id: string | null;
  action: string;
  environment: "staging" | "production";
}

// ---------------------------------------------------------------- calls

export const api = {
  health: () =>
    req<{ ok: boolean; network: string; chainId: number; block: string | null; worldId: string; publicUrl?: string }>("/health"),
  deployments: () => req<Deployments>("/api/deployments"),
  feed: (node?: string, limit = 60) => req<FeedEvent[]>(`/api/feed?limit=${limit}${node ? `&node=${node}` : ""}`),
  solvency: () => req<Solvency>("/api/solvency"),
  policy: (node: string) => req<PolicyView>(`/api/policy/${node}`),
  policies: (holder?: string) => req<PolicySummary[]>(`/api/policies${holder ? `?holder=${holder}` : ""}`),
  claim: (id: string) => req<{ status: ClaimStatus; vtype: Violation; amount: string; node: Hex; paymentId: string }>(`/api/claims/${id}`),
  demo: () => req<DemoInfo | null>("/api/demo"),
  agentStep: (step: "normal" | "swap" | "attack-swap" | "violation", node?: string) => post<StepResult>("/api/agent/step", { step, node }),
  session: (id: string) => req<WorldIdSession>(`/api/worldid/session/${id}`),
  executeClaim: (claimId: string, session: string) => post<{ txHash: Hex }>(`/api/claims/${claimId}/execute`, { session }),

  idkitConfig: () => req<IdkitConfig>("/api/idkit/config"),
  idkitStatus: (address: string) => req<{ verified: boolean; signal: string }>(`/api/idkit/status/${address}`),
  idkitRpSignature: () => post<{ sig: Hex; nonce: string; created_at: number; expires_at: number }>("/api/idkit/rp-signature", {}),
  idkitVerify: (address: string, idkitResponse: IDKitResult) =>
    post<{ verified: boolean; already?: boolean; txHash?: Hex; error?: string }>("/api/idkit/verify", { address, idkitResponse }),
};

/** Full-page redirect into World ID for Agents (enrollment or fresh claim step-up). */
export function worldIdStartUrl(opts: { purpose: "enroll"; address: string; returnTo: string } | { purpose: "claim"; claimId: string; returnTo: string }) {
  const q = new URLSearchParams(
    opts.purpose === "enroll"
      ? { purpose: "enroll", address: opts.address, returnTo: opts.returnTo }
      : { purpose: "claim", claimId: opts.claimId, returnTo: opts.returnTo },
  );
  return `${BACKEND_URL}/auth/worldid/start?${q}`;
}
