/**
 * One-command local devnet: starts anvil, deploys Person B's contracts + mocks of Person A's with a
 * seeded demo policy (contracts/test/devnet/LocalDevnet.s.sol), writes deployments/local.json,
 * and keeps anvil running until Ctrl+C.
 *
 *   npm run devnet            # terminal 1
 *   npm run dev:local         # terminal 2 — backend against the devnet
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RPC = "http://127.0.0.1:8545";
const contractsDir = fileURLToPath(new URL("../../contracts", import.meta.url));

const anvil = spawn("anvil", ["--port", "8545"], { stdio: ["ignore", "ignore", "inherit"] });
anvil.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => anvil.kill());

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("anvil did not start");
}

await waitForRpc();
const deploy = spawnSync(
  "forge",
  ["script", "test/devnet/LocalDevnet.s.sol", "--rpc-url", RPC, "--broadcast"],
  { cwd: contractsDir, stdio: "inherit", shell: process.platform === "win32" },
);
if (deploy.status !== 0) {
  anvil.kill();
  process.exit(1);
}
console.log(`\nDevnet ready at ${RPC} — deployments/local.json written. Ctrl+C to stop.`);
