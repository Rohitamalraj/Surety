import { config } from "../config.js";
import type { WorldIdClaims } from "./oidc.js";
import type { Session } from "./sessions.js";
import { hashSub, signEnrollment } from "./signer.js";

/**
 * Enrollment at policy purchase (PRD §11.1 A). The id_token has already been fully validated.
 * Binds the policyholder's wallet to the pairwise `sub` by signing an EIP-712 Enrollment that
 * PolicyRegistry.issuePolicy passes to WorldIdGate.verifyEnrollment.
 */
export async function completeEnrollment(session: Session, claims: WorldIdClaims) {
  if (!session.address) throw new Error("enroll session has no policyholder address");
  const subHash = hashSub(claims.sub);
  const expiry = Math.floor(Date.now() / 1000) + config.attestationTtlSec;
  const sig = await signEnrollment(session.address, subHash, expiry);
  session.status = "approved";
  session.result = { subHash, expiry, authTime: claims.auth_time, sig };
}
