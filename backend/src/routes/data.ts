import { Hono } from "hono";
import { isHex, type Hex } from "viem";
import { config } from "../config.js";
import {
  abis,
  addr,
  chain,
  ClaimStatus,
  isDeployed,
  publicClient,
  readClaim,
  readPolicy,
  readViolation,
  ViolationType,
  walletFor,
} from "../chain/contracts.js";
import { claimIdsFor, feed, indexerStatus, paymentEvents, syncNow } from "../indexer/watchEvents.js";
import { runStep, type Step } from "../agent/simulator.js";
import { jsonSafe } from "../lib/json.js";
import { describeError } from "../lib/errors.js";

/** Read APIs for the frontend (PRD §16.2) plus the demo console's agent controls. */
export const data = new Hono();

data.use("*", async (c, next) => {
  if (!isDeployed()) return c.json({ error: `contracts not deployed on ${config.network} yet` }, 503);
  await next();
});

const isNode = (s: string): s is Hex => isHex(s) && s.length === 66;

data.get("/feed", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
  return c.json(feed({ node: c.req.query("node"), limit }));
});

data.get("/indexer", (c) => c.json(indexerStatus()));

data.get("/solvency", async (c) => {
  const [liquidReserve, totalCoverage] = await Promise.all([
    publicClient.readContract({ address: addr("SuretyHook"), abi: abis.hook, functionName: "liquidReserve" }),
    publicClient.readContract({ address: addr("PolicyRegistry"), abi: abis.registry, functionName: "totalCoverage" }),
  ]);
  const ratio = totalCoverage === 0n ? null : Number((liquidReserve * 10_000n) / totalCoverage) / 10_000;
  return c.json({ liquidReserve: liquidReserve.toString(), totalCoverage: totalCoverage.toString(), ratio, required: 2 });
});

data.get("/policy/:node", async (c) => {
  const node = c.req.param("node");
  if (!isNode(node)) return c.json({ error: "node must be a 32-byte hex namehash" }, 400);
  const policy = await readPolicy(node);
  if (policy.policyholder === "0x0000000000000000000000000000000000000000") return c.json({ error: "no policy" }, 404);

  const payments = await Promise.all(
    paymentEvents(node).map(async (e) => ({
      paymentId: e.paymentId!,
      to: e.data.to,
      amount: e.data.amount,
      txHash: e.txHash,
      timestamp: e.timestamp,
      violation: await readViolation(BigInt(e.paymentId!)),
    })),
  );
  const claims = await Promise.all(
    claimIdsFor(node).map(async (id) => {
      const cl = await readClaim(id);
      return {
        claimId: id.toString(),
        paymentId: cl.paymentId.toString(),
        vtype: ViolationType[cl.vtype],
        amount: cl.amount.toString(),
        status: ClaimStatus[cl.status],
        filedAt: Number(cl.filedAt),
      };
    }),
  );
  return c.json({
    node,
    label: config.deployments.demo?.node === node ? config.deployments.demo.label : undefined,
    policy: jsonSafe(policy),
    payments,
    claims,
    events: feed({ node, limit: 200 }),
  });
});

data.get("/claims/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "bad claim id" }, 400);
  const cl = await readClaim(BigInt(id));
  if (cl.status === 0) return c.json({ error: "no claim" }, 404);
  return c.json({ ...(jsonSafe(cl) as object), status: ClaimStatus[cl.status], vtype: ViolationType[cl.vtype] });
});

// ---------------------------------------------------------------- demo console

/** The demo info written by the seed script, so the frontend knows the scripted actors. */
data.get("/demo", (c) => c.json(config.deployments.demo ?? null));

data.post("/agent/step", async (c) => {
  const body = await c.req.json<{ step?: Step; node?: string }>().catch(() => ({}) as { step?: Step; node?: string });
  if (!body.step || !["normal", "attack-swap", "violation"].includes(body.step)) {
    return c.json({ error: "step must be normal | attack-swap | violation" }, 400);
  }
  if (body.node && !isNode(body.node)) return c.json({ error: "bad node" }, 400);
  try {
    const result = await runStep(body.step, body.node as Hex | undefined);
    await syncNow();
    return c.json(result);
  } catch (err) {
    return c.json({ error: describeError(err) }, 500);
  }
});


