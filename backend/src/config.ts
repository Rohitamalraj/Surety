import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/** Contract addresses written by contracts/script/Deploy.s.sol, keyed by contract name. */
export type Deployments = Partial<
  Record<
    "MockUSDC" | "PolicyRegistry" | "AgentVault" | "SuretyHook" | "ViolationOracle" | "WorldIdGate" | "ClaimRouter",
    Address
  >
> & { deployBlock?: number };

function loadDeployments(): Deployments {
  const path = fileURLToPath(new URL("../../deployments/sepolia.json", import.meta.url));
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Deployments;
}

export const config = {
  port: Number(optional("PORT", "8787")),
  publicUrl: optional("PUBLIC_URL", "http://localhost:8787").replace(/\/$/, ""),
  frontendUrl: optional("FRONTEND_URL", "http://localhost:3000").replace(/\/$/, ""),

  worldId: {
    issuer: optional("WORLDID_ISSUER", "https://sandbox.auth.world.org"),
    clientId: optional("WORLDID_CLIENT_ID"),
    clientSecret: optional("WORLDID_CLIENT_SECRET"),
    authMethod: optional("WORLDID_AUTH_METHOD", "client_secret_basic") as "client_secret_basic" | "client_secret_post",
    acr: "https://world.org/oidc/acr/orb-v3",
  },

  chain: {
    rpcUrl: optional("SEPOLIA_RPC_URL"),
    chainId: Number(optional("CHAIN_ID", "11155111")),
    signerPk: optional("BACKEND_SIGNER_PK") as Hex | "",
    agentPk: optional("AGENT_PK") as Hex | "",
    deployBlock: BigInt(optional("DEPLOY_BLOCK", "0")),
  },

  deployments: loadDeployments(),

  /** How long a signed approval stays valid on-chain. */
  attestationTtlSec: 10 * 60,
  /** How long a World ID login attempt may take before it counts as expired. */
  sessionTtlSec: 10 * 60,
  /** Tolerated clock skew between World ID's auth_time and our clock. */
  clockSkewSec: 60,
} as const;

export const redirectUri = () => `${config.publicUrl}/auth/worldid/callback`;
