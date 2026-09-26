import type { Address, Hex } from "viem";
import { config } from "../config.js";
import { randomToken } from "./oidc.js";

export type Purpose = "enroll" | "claim";
export type SessionStatus = "pending" | "approved" | "denied" | "expired" | "cancelled" | "mismatch";

/** What the frontend may see. Everything needed to submit on-chain; nothing secret. */
export interface SessionResult {
  subHash?: Hex;
  expiry?: number;
  authTime?: number;
  sig?: Hex;
  reason?: string;
  heldTx?: Hex;
}

export interface Session {
  id: string;
  purpose: Purpose;
  address?: Address; // enroll: the policyholder wallet
  claimId?: bigint; // claim: the on-chain claim id
  returnTo?: string; // frontend path to go back to
  // OIDC attempt state — server-side only
  state: string;
  nonce: string;
  verifier: string;
  startedAt: number;
  status: SessionStatus;
  result: SessionResult;
}

const byId = new Map<string, Session>();
const byState = new Map<string, string>();

const now = () => Math.floor(Date.now() / 1000);

export function createSession(init: Pick<Session, "purpose" | "address" | "claimId" | "returnTo" | "verifier">): Session {
  const s: Session = {
    ...init,
    id: randomToken(16),
    state: randomToken(),
    nonce: randomToken(),
    startedAt: now(),
    status: "pending",
    result: {},
  };
  byId.set(s.id, s);
  byState.set(s.state, s.id);
  return s;
}

export function getSession(id: string): Session | undefined {
  const s = byId.get(id);
  if (s && s.status === "pending" && now() - s.startedAt > config.sessionTtlSec) s.status = "expired";
  return s;
}

/** Consumes the state: each authorization response can be redeemed once. */
export function takeSessionByState(state: string): Session | undefined {
  const id = byState.get(state);
  if (!id) return undefined;
  byState.delete(state);
  return getSession(id);
}

export function publicView(s: Session) {
  return {
    id: s.id,
    purpose: s.purpose,
    status: s.status,
    address: s.address,
    claimId: s.claimId?.toString(),
    returnTo: s.returnTo,
    ...s.result,
  };
}

setInterval(() => {
  const cutoff = now() - 2 * config.sessionTtlSec;
  for (const [id, s] of byId) if (s.startedAt < cutoff) byId.delete(id);
}, 60_000).unref();
