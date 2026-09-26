import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { getAddress, type Address, type Hex } from "viem";
import { config } from "../config.js";
import { abis, addr, chain, publicClient, walletFor } from "../chain/contracts.js";
import { signerAccount } from "../worldid/signer.js";

/**
 * IDKit proof of unique human at policy purchase (PRD §11.2, World "Best Use of IDKit").
 *
 * The trust moment: the shared premium pool pays claims, so one person must not be able to open
 * many policies from many wallets and farm it. Before buying, the policyholder proves with World ID
 * that they are a unique human; the proof's signal is their wallet address, so it can't be reused
 * for another wallet. The backend verifies it with the Developer Portal and records the
 * action-scoped nullifier on-chain in WorldIdGate — one human, one wallet.
 *
 * Minimum sufficient credential: Proof of Human (`proofOfHuman` preset). No personal data.
 */

export const idkitEnabled = () => !!(config.idkit.appId && config.idkit.rpId && config.idkit.signingKey);

/** The signal every proof must be bound to: the lowercase policyholder address. */
export const signalFor = (wallet: Address) => getAddress(wallet).toLowerCase();

// Nonces we issued RP signatures for; each may be used by exactly one proof.
const issuedNonces = new Map<string, number>();

export function issueRpSignature() {
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: config.idkit.signingKey,
    action: config.idkit.action,
  });
  issuedNonces.set(nonce, expiresAt);
  return { sig, nonce, created_at: createdAt, expires_at: expiresAt };
}

/** Test hook. */
export function rememberNonceForTests(nonce: string, expiresAt: number) {
  issuedNonces.set(nonce, expiresAt);
}

export class ProofRejected extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
  }
}

/**
 * Local checks before we spend a Portal call. The Portal proves the proof is cryptographically
 * valid; *we* must make sure it is for our action, our request, our environment, and this wallet.
 */
export function checkResult(result: IDKitResult, wallet: Address, now = Math.floor(Date.now() / 1000)) {
  if (!result || !Array.isArray(result.responses) || result.responses.length === 0) {
    throw new ProofRejected("empty IDKit result");
  }
  if ("session_id" in result) throw new ProofRejected("session proofs are not accepted here");
  if (result.action !== config.idkit.action) throw new ProofRejected("proof is for a different action");
  if (result.environment !== config.idkit.environment) {
    throw new ProofRejected(`proof environment is ${result.environment}, expected ${config.idkit.environment}`);
  }

  const expiresAt = issuedNonces.get(result.nonce);
  if (expiresAt === undefined) throw new ProofRejected("unknown or already-used request nonce");
  if (now > expiresAt) throw new ProofRejected("request expired — start again");

  const expected = hashSignal(signalFor(wallet)).toLowerCase();
  for (const r of result.responses) {
    if (r.signal_hash?.toLowerCase() !== expected) throw new ProofRejected("proof is not bound to this wallet");
  }
}

interface PortalVerifyResponse {
  success?: boolean;
  nullifier?: string;
  environment?: string;
  action?: string;
  detail?: string;
  code?: string;
}

/** Forwards the IDKit result as-is to the Developer Portal. Returns the verified nullifier. */
export async function verifyWithPortal(result: IDKitResult): Promise<bigint> {
  const res = await fetch(`${config.idkit.verifyBaseUrl}/${config.idkit.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
  const body = (await res.json().catch(() => ({}))) as PortalVerifyResponse;
  if (!res.ok || body.success !== true) {
    throw new ProofRejected(`World ID verification failed: ${body.detail ?? body.code ?? `HTTP ${res.status}`}`);
  }
  if (body.environment && body.environment !== config.idkit.environment) {
    throw new ProofRejected(`verified in ${body.environment}, expected ${config.idkit.environment}`);
  }
  const first = result.responses[0];
  const nullifier = body.nullifier ?? (first && "nullifier" in first ? first.nullifier : undefined);
  if (!nullifier) throw new ProofRejected("no nullifier in verification result");
  return BigInt(nullifier);
}

export async function humanStatus(wallet: Address) {
  const nullifier = await publicClient.readContract({
    address: addr("WorldIdGate"),
    abi: abis.gate,
    functionName: "humanNullifier",
    args: [wallet],
  });
  return { verified: nullifier !== 0n };
}

/**
 * Records the nullifier on-chain (WorldIdGate.registerHuman). The chain is the uniqueness store:
 * it survives backend restarts and anyone can audit it. Idempotent for the same wallet + human.
 */
export async function registerHuman(wallet: Address, nullifier: bigint): Promise<{ txHash?: Hex; already: boolean }> {
  const gate = addr("WorldIdGate");
  const [owner, existing] = await Promise.all([
    publicClient.readContract({ address: gate, abi: abis.gate, functionName: "nullifierOwner", args: [nullifier] }),
    publicClient.readContract({ address: gate, abi: abis.gate, functionName: "humanNullifier", args: [wallet] }),
  ]);
  const zero = "0x0000000000000000000000000000000000000000";
  if (owner !== zero) {
    if (getAddress(owner) === getAddress(wallet)) return { already: true };
    throw new ProofRejected("This human has already verified a different wallet. One person, one policy wallet.", 409);
  }
  if (existing !== 0n) {
    throw new ProofRejected("This wallet is already linked to a different World ID.", 409);
  }

  const w = walletFor(signerAccount());
  const txHash = await w.writeContract({
    account: w.account!,
    chain,
    address: gate,
    abi: abis.gate,
    functionName: "registerHuman",
    args: [wallet, nullifier],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, already: false };
}

/** Consumes the nonce once the proof is accepted, so the same proof can't be replayed. */
export function consumeNonce(nonce: string) {
  issuedNonces.delete(nonce);
}

setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [n, exp] of issuedNonces) if (exp < now - 3600) issuedNonces.delete(n);
}, 60_000).unref();
