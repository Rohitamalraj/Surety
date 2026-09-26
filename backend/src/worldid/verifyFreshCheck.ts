import { config } from "../config.js";
import { ClaimStatus, markHeld, readClaim, readPolicy } from "../chain/contracts.js";
import { isFreshForAttempt, type WorldIdClaims } from "./oidc.js";
import type { Session, SessionStatus } from "./sessions.js";
import { hashSub, signClaimApproval } from "./signer.js";

/**
 * Claim payout step-up (PRD §11.1 B). The id_token has already been validated (issuer, signature,
 * audience, expiry, nonce). Here we enforce what makes it a *fresh check by the same human*:
 *   - authentication belongs to this attempt (max_age=0 / prompt=login semantics)
 *   - keccak256(sub) equals the subHash stored on the policy at purchase
 * Any failure holds the claim on-chain instead of paying it.
 */
export async function completeClaimCheck(session: Session, claims: WorldIdClaims) {
  const claimId = session.claimId!;
  const claim = await readClaim(claimId);
  const status = ClaimStatus[claim.status];
  if (status !== "Pending" && status !== "Held") {
    return fail(session, "denied", `claim is ${status}`);
  }

  if (!isFreshForAttempt(claims.auth_time, session.startedAt)) {
    return fail(session, "expired", "World ID authentication was not fresh for this claim");
  }

  const policy = await readPolicy(claim.node);
  const subHash = hashSub(claims.sub);
  if (subHash !== policy.subHash) {
    return fail(session, "mismatch", "World ID account does not match the policyholder");
  }

  const expiry = Math.floor(Date.now() / 1000) + config.attestationTtlSec;
  const sig = await signClaimApproval(claimId, subHash, claims.auth_time, expiry);
  session.status = "approved";
  session.result = { subHash, authTime: claims.auth_time, expiry, sig };
}

/**
 * Marks the session failed and, for claims, holds the claim on-chain (PRD §8.4).
 * Used for callback errors (cancelled/denied) as well as validation failures.
 */
export async function fail(session: Session, status: Exclude<SessionStatus, "pending" | "approved">, reason: string) {
  session.status = status;
  session.result = { reason };
  if (session.purpose !== "claim" || session.claimId === undefined) return;
  try {
    const claim = await readClaim(session.claimId);
    const s = ClaimStatus[claim.status];
    if (s === "Pending" || s === "Held") {
      session.result.heldTx = await markHeld(session.claimId, `${status}: ${reason}`);
    }
  } catch (err) {
    console.error(`markHeld failed for claim ${session.claimId}:`, (err as Error).message);
  }
}
