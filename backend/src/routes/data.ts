import { Hono } from "hono";
import { decodeEventLog, isHex, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
import { getSession } from "../worldid/sessions.js";
import { signerAccount } from "../worldid/signer.js";

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

/**
 * Demo console convenience: files a claim as the demo policyholder, no browser wallet popup.
 * The policy page uses the connected wallet instead; the World ID step-up still gates payout.
 */
data.post("/demo/file-claim", async (c) => {
  if (!config.chain.policyholderPk) return c.json({ error: "POLICYHOLDER_PK not configured" }, 501);
  const { paymentId, node } = await c.req.json<{ paymentId?: string; node?: string }>().catch(() => ({}) as Record<string, string>);
  const target = (node ?? config.deployments.demo?.node) as Hex | undefined;
  if (!paymentId || !/^\d+$/.test(paymentId) || !target || !isNode(target)) return c.json({ error: "paymentId required" }, 400);

  const w = walletFor(privateKeyToAccount(config.chain.policyholderPk));
  try {
    const txHash = await w.writeContract({
      account: w.account!,
      chain,
      address: addr("ClaimRouter"),
      abi: abis.router,
      functionName: "fileClaim",
      args: [target, BigInt(paymentId)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    let claimId: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: abis.router, data: log.data, topics: log.topics });
        if (ev.eventName === "ClaimFiled") claimId = ev.args.claimId.toString();
      } catch {}
    }
    await syncNow();
    return c.json({ txHash, claimId });
  } catch (err) {
    return c.json({ error: describeError(err) }, 500);
  }
});

/**
 * Local devnet only: bind the seeded demo policy to a real World ID for Agents identity.
 * The devnet seeds the policy with a placeholder subHash; after the user completes a real enrollment
 * (validated server-side like any other), this copies that session's subHash onto the demo policy so
 * the claim-time fresh check matches the same real human. Never available on Sepolia.
 */
const devRegistryAbi = parseAbi([
  "function setPolicy(bytes32 node, (address policyholder,address agent,address payoutAddr,uint256 coverageLimit,uint256 perTxCap,uint8 tier,uint32 streak,uint32 claimsCount,bytes32 subHash,uint256 paidOut,uint64 issuedAt,bool active) p)",
]);

data.post("/demo/bind-human", async (c) => {
  if (config.network !== "local") return c.json({ error: "only available on the local devnet" }, 404);
  const { session } = await c.req.json<{ session?: string }>().catch(() => ({}) as { session?: string });
  const s = session ? getSession(session) : undefined;
  if (!s || s.purpose !== "enroll") return c.json({ error: "no enrollment session" }, 400);
  if (s.status !== "approved" || !s.result.subHash) return c.json({ error: `World ID session is ${s.status}` }, 409);
  const node = config.deployments.demo?.node;
  if (!node) return c.json({ error: "no demo policy seeded" }, 404);

  try {
    const policy = await readPolicy(node);
    const w = walletFor(signerAccount());
    const txHash = await w.writeContract({
      account: w.account!,
      chain,
      address: addr("PolicyRegistry"),
      abi: devRegistryAbi,
      functionName: "setPolicy",
      args: [node, { ...policy, subHash: s.result.subHash }],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return c.json({ bound: true, txHash, subHash: s.result.subHash });
  } catch (err) {
    return c.json({ error: describeError(err) }, 500);
  }
});
