import { Hono } from "hono";
import { isAddress, type Address } from "viem";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { config } from "../config.js";
import { isDeployed } from "../chain/contracts.js";
import { describeError } from "../lib/errors.js";
import {
  checkResult,
  consumeNonce,
  humanStatus,
  idkitEnabled,
  issueRpSignature,
  ProofRejected,
  registerHuman,
  signalFor,
  verifyWithPortal,
} from "../idkit/proofOfHuman.js";

/**
 * IDKit proof-of-human endpoints (mounted at /api/idkit).
 *
 * Frontend flow on Create Policy:
 *   1. GET  /config                → app_id, rp_id, action, environment (public values)
 *   2. POST /rp-signature          → rp_context for IDKitRequestWidget
 *   3. widget with preset proofOfHuman({ signal: <config.signal for the wallet> })
 *   4. handleVerify: POST /verify { address, idkitResponse }  → { verified, txHash }
 *   5. then World ID for Agents enrollment → issuePolicy
 */
export const idkit = new Hono();

idkit.get("/config", (c) =>
  c.json({
    enabled: idkitEnabled(),
    app_id: config.idkit.appId || null,
    rp_id: config.idkit.rpId || null,
    action: config.idkit.action,
    environment: config.idkit.environment,
    /** Signal to pass to the preset: signalFor(address). Shown here so the frontend matches exactly. */
    signalRule: "lowercase policyholder address",
  }),
);

idkit.get("/status/:address", async (c) => {
  const address = c.req.param("address");
  if (!isAddress(address)) return c.json({ error: "bad address" }, 400);
  if (!isDeployed()) return c.json({ error: "contracts not deployed" }, 503);
  return c.json({ address, signal: signalFor(address), ...(await humanStatus(address)) });
});

idkit.post("/rp-signature", (c) => {
  if (!idkitEnabled()) return c.json({ error: "IDKit is not configured on this backend" }, 501);
  return c.json(issueRpSignature());
});

idkit.post("/verify", async (c) => {
  if (!idkitEnabled()) return c.json({ error: "IDKit is not configured on this backend" }, 501);
  const body = await c.req
    .json<{ address?: string; idkitResponse?: IDKitResult }>()
    .catch(() => ({}) as { address?: string; idkitResponse?: IDKitResult });
  if (!body.address || !isAddress(body.address)) return c.json({ error: "address required" }, 400);
  if (!body.idkitResponse) return c.json({ error: "idkitResponse required" }, 400);
  const wallet = body.address as Address;

  try {
    checkResult(body.idkitResponse, wallet);
    const nullifier = await verifyWithPortal(body.idkitResponse);
    consumeNonce(body.idkitResponse.nonce);
    const { txHash, already } = await registerHuman(wallet, nullifier);
    return c.json({ verified: true, already, txHash });
  } catch (err) {
    if (err instanceof ProofRejected) return c.json({ verified: false, error: err.message }, err.status);
    return c.json({ verified: false, error: describeError(err) }, 500);
  }
});
