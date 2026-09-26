import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

/**
 * IDKit end-to-end on a local chain: real backend routes + real WorldIdGate, with a fake World
 * Developer Portal standing in for POST /api/v4/verify/{rp_id}.
 */
const RPC_PORT = 8597;
const PORTAL_PORT = 8596;
const contractsDir = fileURLToPath(new URL("../../contracts", import.meta.url));

process.env.NETWORK = "local";
process.env.LOCAL_RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
// The devnet's WorldIdGate trusts anvil account #1; don't pick up a real signer from backend/.env.
process.env.BACKEND_SIGNER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.AGENT_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
process.env.IDKIT_APP_ID = "app_test";
process.env.IDKIT_RP_ID = "rp_test";
process.env.IDKIT_SIGNING_KEY = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.IDKIT_ACTION = "surety-buy-policy";
process.env.IDKIT_ENVIRONMENT = "staging";
process.env.IDKIT_VERIFY_URL = `http://127.0.0.1:${PORTAL_PORT}/api/v4/verify`;

let anvil: ChildProcess;
let portal: Server;
let portalReply: { status: number; body: unknown } = { status: 200, body: {} };
let app: typeof import("../src/server.js").app;

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";

async function rpcUp() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${RPC_PORT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start");
}

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(RPC_PORT), "--silent"], { stdio: "ignore" });
  await rpcUp();
  const deploy = spawnSync(
    "forge",
    ["script", "test/devnet/LocalDevnet.s.sol", "--rpc-url", `http://127.0.0.1:${RPC_PORT}`, "--broadcast"],
    { cwd: contractsDir, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (deploy.status !== 0) throw new Error(deploy.stderr || deploy.stdout);

  portal = createServer((req, res) => {
    res.writeHead(portalReply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(portalReply.body));
  }).listen(PORTAL_PORT);

  ({ app } = await import("../src/server.js"));
}, 180_000);

afterAll(() => {
  anvil?.kill();
  portal?.close();
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function newProof(wallet: string, overrides: Record<string, unknown> = {}) {
  const rp = (await (await post("/api/idkit/rp-signature", {})).json()) as { nonce: string };
  return {
    protocol_version: "4.0",
    nonce: rp.nonce,
    action: "surety-buy-policy",
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(wallet.toLowerCase()),
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        nullifier: "0x0abc",
        issuer_schema_id: 1,
        expires_at_min: 1_900_000_000,
      },
    ],
    ...overrides,
  };
}

const portalOk = (nullifier: string) =>
  (portalReply = { status: 200, body: { success: true, nullifier, environment: "staging", action: "surety-buy-policy", results: [] } });

describe("IDKit proof of human", () => {
  it("exposes public config", async () => {
    const cfg = (await (await app.request("/api/idkit/config")).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({ enabled: true, app_id: "app_test", rp_id: "rp_test", action: "surety-buy-policy" });
  });

  it("signs RP requests", async () => {
    const rp = (await (await post("/api/idkit/rp-signature", {})).json()) as Record<string, unknown>;
    expect(rp.sig).toMatch(/^0x[0-9a-f]+$/i);
    expect(typeof rp.nonce).toBe("string");
    expect(Number(rp.expires_at)).toBeGreaterThan(Number(rp.created_at));
  });

  it("verifies a unique human and records it on-chain", async () => {
    portalOk("0x0abc");
    const res = await post("/api/idkit/verify", { address: WALLET_A, idkitResponse: await newProof(WALLET_A) });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ verified: true, already: false });
    expect(body.txHash).toMatch(/^0x/);

    const status = (await (await app.request(`/api/idkit/status/${WALLET_A}`)).json()) as { verified: boolean };
    expect(status.verified).toBe(true);
  });

  it("rejects replaying the same proof (nonce is one-use)", async () => {
    portalOk("0x0abc");
    const proof = await newProof(WALLET_A);
    await post("/api/idkit/verify", { address: WALLET_A, idkitResponse: proof }); // idempotent re-verify
    const replay = await post("/api/idkit/verify", { address: WALLET_A, idkitResponse: proof });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toMatch(/nonce/);
  });

  it("Sybil: the same human cannot back a second wallet", async () => {
    portalOk("0x0abc"); // same nullifier = same human
    const res = await post("/api/idkit/verify", { address: WALLET_B, idkitResponse: await newProof(WALLET_B) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/already verified a different wallet/);
  });

  it("rejects a proof bound to a different wallet", async () => {
    portalOk("0x0def");
    const res = await post("/api/idkit/verify", { address: WALLET_B, idkitResponse: await newProof(WALLET_A) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/not bound to this wallet/);
  });

  it("rejects the wrong environment", async () => {
    portalOk("0x0def");
    const proof = await newProof(WALLET_B, { environment: "production" });
    const res = await post("/api/idkit/verify", { address: WALLET_B, idkitResponse: proof });
    expect(res.status).toBe(400);
  });

  it("rejects when the Developer Portal says the proof is invalid", async () => {
    portalReply = { status: 400, body: { success: false, detail: "All proof verifications failed." } };
    const res = await post("/api/idkit/verify", { address: WALLET_B, idkitResponse: await newProof(WALLET_B) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/verification failed/);
    const status = (await (await app.request(`/api/idkit/status/${WALLET_B}`)).json()) as { verified: boolean };
    expect(status.verified).toBe(false);
  });

  it("a second, different human can verify wallet B", async () => {
    portalOk("0x0def");
    const res = await post("/api/idkit/verify", { address: WALLET_B, idkitResponse: await newProof(WALLET_B) });
    expect(res.status).toBe(200);
  });

  it("alternative path: enrollment is refused until the wallet proves a unique human", async () => {
    const unverified = "0x3333333333333333333333333333333333333333";
    const blocked = await app.request(`/auth/worldid/start?purpose=enroll&address=${unverified}&returnTo=/`);
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("location")).toMatch(/error=unique_human_required/);

    const allowed = await app.request(`/auth/worldid/start?purpose=enroll&address=${WALLET_A}&returnTo=/`);
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get("location")).not.toMatch(/error=/);
  });
});
