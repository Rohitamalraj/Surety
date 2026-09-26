import { namehash, normalize } from "viem/ens";
import type { PublicClient } from "viem";
import { resolverAbi } from "./abi";
import { ENS_PARENT } from "./config";

/** `agent1` → namehash("agent1.surety.eth"). A 32-byte hex passes through untouched. */
export function nodeFor(nameOrNode: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(nameOrNode)) return nameOrNode as `0x${string}`;
  return namehash(normalize(fullName(nameOrNode)));
}

export const fullName = (label: string) => (label.includes(".") ? label : `${label}.${ENS_PARENT}`);

/** Published policy records (PRD §10.3). */
export const RECORD_KEYS = [
  "surety.coverageLimit",
  "surety.perTxCap",
  "surety.allowlist",
  "surety.tier",
  "surety.premium",
  "surety.streak",
  "surety.policyholder",
  "surety.status",
] as const;

/**
 * Reads the policy's ENS text records. Invariant 4: the resolver address is resolved fresh on every
 * call (ENSv2 deploys a resolver per policy), never cached or hard-coded.
 */
export async function readPolicyRecords(client: PublicClient, name: string): Promise<Record<string, string> | null> {
  try {
    const resolver = await client.getEnsResolver({ name: normalize(fullName(name)) });
    if (!resolver) return null;
    const node = nodeFor(name);
    const values = await Promise.all(
      RECORD_KEYS.map((key) =>
        client.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, key] }).catch(() => ""),
      ),
    );
    return Object.fromEntries(RECORD_KEYS.map((k, i) => [k, values[i]]));
  } catch {
    return null;
  }
}
