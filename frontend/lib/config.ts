import { foundry, sepolia } from "viem/chains";

/** Surety backend (World ID validation, indexer, demo agent). */
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787").replace(/\/$/, "");

/** `local` = anvil devnet (backend `npm run devnet`), `sepolia` = the real deployment. */
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "local") as "local" | "sepolia";

export const CHAIN = NETWORK === "sepolia" ? sepolia : foundry;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? (NETWORK === "sepolia" ? "https://ethereum-sepolia-rpc.publicnode.com" : "http://127.0.0.1:8545");

export const EXPLORER = NETWORK === "sepolia" ? "https://sepolia.etherscan.io" : null;

/** Every policy is a subname of this parent (PRD §10.1). */
export const ENS_PARENT = process.env.NEXT_PUBLIC_ENS_PARENT ?? "surety.eth";

export const USDC_DECIMALS = 6;
