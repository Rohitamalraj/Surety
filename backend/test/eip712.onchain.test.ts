import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { hashSub, setSignerForTests, signEnrollment } from "../src/worldid/signer.js";
import { config } from "../src/config.js";

/**
 * Cross-language check: a signature produced by the TypeScript backend must be accepted by the
 * real WorldIdGate.sol. Spins up anvil, deploys the gate with `forge create`, verifies on-chain.
 */
const PORT = 8599;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil default account #0 — deployer; account #1 — backend signer
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SIGNER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const contractsDir = fileURLToPath(new URL("../../contracts", import.meta.url));

let anvil: ChildProcess;
let gate: Address;
const client = createPublicClient({ chain: foundry, transport: http(RPC) });
const gateAbi = parseAbi([
  "function verifyEnrollment(address,bytes32,uint64,bytes) view returns (bool)",
]);

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const signer = privateKeyToAccount(SIGNER_PK).address;
  const deployer = privateKeyToAccount(DEPLOYER_PK).address;
  const out = execFileSync(
    "forge",
    ["create", "src/WorldIdGate.sol:WorldIdGate", "--rpc-url", RPC, "--private-key", DEPLOYER_PK, "--broadcast",
      "--constructor-args", signer, deployer],
    { cwd: contractsDir, encoding: "utf8" },
  );
  gate = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)![1] as Address;
  setSignerForTests(privateKeyToAccount(SIGNER_PK));
  (config.chain as { chainId: number }).chainId = foundry.id;
}, 120_000);

afterAll(() => anvil?.kill());

describe("EIP-712 backend ↔ WorldIdGate.sol", () => {
  it("enrollment signed in TS verifies on-chain", async () => {
    const policyholder = "0x000000000000000000000000000000000000dEaD" as Address;
    const subHash = hashSub("pairwise-sub-abc");
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signEnrollment(policyholder, subHash, expiry, gate);

    const ok = await client.readContract({
      address: gate,
      abi: gateAbi,
      functionName: "verifyEnrollment",
      args: [policyholder, subHash, BigInt(expiry), sig],
    });
    expect(ok).toBe(true);

    const tampered = await client.readContract({
      address: gate,
      abi: gateAbi,
      functionName: "verifyEnrollment",
      args: [policyholder, hashSub("someone-else"), BigInt(expiry), sig],
    });
    expect(tampered).toBe(false);
  });
});
