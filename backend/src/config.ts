import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export type ContractName =
  | "MockUSDC"
  | "PolicyRegistry"
  | "AgentVault"
  | "SuretyHook"
  | "ViolationOracle"
  | "WorldIdGate"
  | "ClaimRouter";

/** Demo actors written by the seed script (SeedDemo.s.sol on Sepolia, LocalDevnet.s.sol locally). */
export interface DemoInfo {
  label: string;
  node: Hex;
  agent: Address;
  policyholder: Address;
  merchant: Address; // on the allowlist
  attacker: Address; // off the allowlist
  payout: Address;
}

/** v4 pool the agent swaps through (Sepolia). `hooks` is SuretyHook. */
export interface PoolInfo {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
}

/** deployments/<network>.json, keyed by contract name. */
export type Deployments = Partial<Record<ContractName, Address>> & {
  deployBlock?: number;
  demo?: DemoInfo;
  pool?: PoolInfo;
};

/** `local` = anvil devnet (contracts/test/devnet/LocalDevnet.s.sol), `sepolia` = the real deployment. */
const network = optional("NETWORK", "sepolia") as "local" | "sepolia";
const isLocal = network === "local";

// anvil's well-known dev keys (#1 backend signer, #2 agent, #3 policyholder). Local devnet only — never real funds.
const ANVIL_SIGNER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ANVIL_AGENT_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

function loadDeployments(): Deployments {
  const path = fileURLToPath(new URL(`../../deployments/${network}.json`, import.meta.url));
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Deployments;
}

const deployments = loadDeployments();

export const config = {
  network,
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

  /** IDKit proof-of-human at policy purchase (PRD §11.2). Disabled when app/rp/key are unset. */
  idkit: {
    appId: optional("IDKIT_APP_ID"),
    rpId: optional("IDKIT_RP_ID"),
    signingKey: optional("IDKIT_SIGNING_KEY"),
    action: optional("IDKIT_ACTION", "surety-buy-policy"),
    environment: optional("IDKIT_ENVIRONMENT", "staging") as "staging" | "production",
    verifyBaseUrl: optional("IDKIT_VERIFY_URL", "https://developer.world.org/api/v4/verify"),
    /**
     * Staging (simulator) proofs are only accepted inside a 24h staging window opened by the app's
     * team; the token it issues must be sent as `x-staging-verification-token`. Not needed in production.
     */
    stagingToken: optional("IDKIT_STAGING_TOKEN"),
  },

  chain: {
    rpcUrl: isLocal ? optional("LOCAL_RPC_URL", "http://127.0.0.1:8545") : optional("SEPOLIA_RPC_URL"),
    chainId: isLocal ? 31337 : 11155111,
    signerPk: optional("BACKEND_SIGNER_PK", isLocal ? ANVIL_SIGNER_PK : "") as Hex | "",
    agentPk: optional("AGENT_PK", isLocal ? ANVIL_AGENT_PK : "") as Hex | "",
    deployBlock: BigInt(optional("DEPLOY_BLOCK", String(deployments.deployBlock ?? 0))),
    /**
     * Log indexing needs wide eth_getLogs ranges; Alchemy's free tier caps them at 10 blocks, so the
     * indexer uses its own RPC (Tenderly's public Sepolia gateway by default).
     */
    indexerRpcUrl: isLocal
      ? optional("LOCAL_RPC_URL", "http://127.0.0.1:8545")
      : optional("INDEXER_RPC_URL", "https://sepolia.gateway.tenderly.co"),
    pollMs: isLocal ? 1_000 : 4_000,
  },

  deployments,

  /** The hosted payments agent's brain: Groq's OpenAI-compatible chat API with tool calling. */
  groq: {
    apiKey: optional("GROQ_API_KEY"),
    model: optional("GROQ_MODEL", "openai/gpt-oss-120b"),
    baseUrl: optional("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
  },

  /** How long a signed approval stays valid on-chain. */
  attestationTtlSec: 10 * 60,
  /** How long a World ID login attempt may take before it counts as expired. */
  sessionTtlSec: 10 * 60,
  /** Tolerated clock skew between World ID's auth_time and our clock. */
  clockSkewSec: 60,
};

export const redirectUri = () => `${config.publicUrl}/auth/worldid/callback`;
