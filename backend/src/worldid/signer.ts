import { keccak256, toHex, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";

/**
 * EIP-712 attestations verified by WorldIdGate.sol. Types and domain must match the contract exactly:
 *   Enrollment(address policyholder,bytes32 subHash,uint64 expiry)
 *   ClaimApproval(uint256 claimId,bytes32 subHash,uint64 authTime,uint64 expiry)
 */
export const eip712Types = {
  Enrollment: [
    { name: "policyholder", type: "address" },
    { name: "subHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
  ClaimApproval: [
    { name: "claimId", type: "uint256" },
    { name: "subHash", type: "bytes32" },
    { name: "authTime", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export function gateDomain(verifyingContract: Address, chainId = config.chain.chainId) {
  return { name: "Surety", version: "1", chainId, verifyingContract } as const;
}

/** The raw pairwise `sub` never leaves this process; only its hash goes on-chain. */
export const hashSub = (sub: string): Hex => keccak256(toHex(sub));

let account: LocalAccount | undefined;
export function signerAccount(): LocalAccount {
  if (!account) {
    if (!config.chain.signerPk) throw new Error("BACKEND_SIGNER_PK is not set");
    account = privateKeyToAccount(config.chain.signerPk);
  }
  return account;
}

export function setSignerForTests(acc: LocalAccount) {
  account = acc;
}

function gateAddress(): Address {
  const gate = config.deployments.WorldIdGate;
  if (!gate) throw new Error("WorldIdGate address missing from deployments/sepolia.json");
  return gate;
}

export async function signEnrollment(policyholder: Address, subHash: Hex, expiry: number, gate = gateAddress()) {
  return signerAccount().signTypedData({
    domain: gateDomain(gate),
    types: eip712Types,
    primaryType: "Enrollment",
    message: { policyholder, subHash, expiry: BigInt(expiry) },
  });
}

export async function signClaimApproval(
  claimId: bigint,
  subHash: Hex,
  authTime: number,
  expiry: number,
  gate = gateAddress(),
) {
  return signerAccount().signTypedData({
    domain: gateDomain(gate),
    types: eip712Types,
    primaryType: "ClaimApproval",
    message: { claimId, subHash, authTime: BigInt(authTime), expiry: BigInt(expiry) },
  });
}
