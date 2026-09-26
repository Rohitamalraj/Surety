import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Hex } from "viem";
import { config } from "./config.js";
import { executeWithApproval, publicClient } from "./chain/contracts.js";
import { buildAuthorizeUrl, exchangeCode, pkcePair, verifyIdToken } from "./worldid/oidc.js";
import { createSession, getSession, publicView, takeSessionByState } from "./worldid/sessions.js";
import { completeEnrollment } from "./worldid/verifyProofOfHuman.js";
import { completeClaimCheck, fail } from "./worldid/verifyFreshCheck.js";

export const app = new Hono();

app.use("/api/*", cors({ origin: config.frontendUrl }));

app.get("/health", async (c) => {
  let block: string | null = null;
  try {
    block = (await publicClient.getBlockNumber()).toString();
  } catch {}
  return c.json({ ok: true, chainId: config.chain.chainId, block, worldIdConfigured: !!config.worldId.clientId });
});

// ---------------------------------------------------------------- World ID for Agents

/** Starts an OIDC attempt. purpose=enroll&address=0x… or purpose=claim&claimId=N */
app.get("/auth/worldid/start", async (c) => {
  const purpose = c.req.query("purpose");
  const returnTo = c.req.query("returnTo") ?? "/";
  if (!returnTo.startsWith("/")) return c.text("returnTo must be a path", 400);

  let session;
  const { verifier, challenge } = pkcePair();
  if (purpose === "enroll") {
    const address = c.req.query("address");
    if (!address || !isAddress(address)) return c.text("address required", 400);
    session = createSession({ purpose, address, returnTo, verifier });
  } else if (purpose === "claim") {
    const claimId = c.req.query("claimId");
    if (!claimId || !/^\d+$/.test(claimId)) return c.text("claimId required", 400);
    session = createSession({ purpose, claimId: BigInt(claimId), returnTo, verifier });
  } else {
    return c.text("purpose must be enroll or claim", 400);
  }

  const url = await buildAuthorizeUrl({
    state: session.state,
    nonce: session.nonce,
    codeChallenge: challenge,
    fresh: purpose === "claim",
  });
  return c.redirect(url, 302);
});

app.get("/auth/worldid/callback", async (c) => {
  const state = c.req.query("state");
  const session = state ? takeSessionByState(state) : undefined;
  if (!session) return c.text("Unknown or already-used login attempt.", 400);

  const back = (id: string) => c.redirect(`${config.frontendUrl}/worldid/return?session=${id}`, 302);

  if (session.status === "expired") {
    await fail(session, "expired", "login attempt expired");
    return back(session.id);
  }

  const error = c.req.query("error");
  if (error) {
    const status = error === "access_denied" ? "cancelled" : "denied";
    await fail(session, status, error);
    return back(session.id);
  }

  const code = c.req.query("code");
  if (!code) {
    await fail(session, "denied", "no authorization code");
    return back(session.id);
  }

  try {
    const idToken = await exchangeCode(code, session.verifier);
    const claims = await verifyIdToken(idToken, session.nonce);
    if (session.purpose === "enroll") await completeEnrollment(session, claims);
    else await completeClaimCheck(session, claims);
  } catch (err) {
    await fail(session, "denied", (err as Error).message);
  }
  return back(session.id);
});

/** Frontend polls this after returning from World ID. */
app.get("/api/worldid/session/:id", (c) => {
  const s = getSession(c.req.param("id"));
  if (!s) return c.json({ error: "not found" }, 404);
  return c.json(publicView(s));
});

/** Relays an approved claim check on-chain in one tx: WorldIdGate.approveClaim + ClaimRouter.execute. */
app.post("/api/claims/:id/execute", async (c) => {
  const { session: sessionId } = await c.req.json<{ session?: string }>();
  const s = sessionId ? getSession(sessionId) : undefined;
  if (!s || s.purpose !== "claim" || s.claimId?.toString() !== c.req.param("id")) {
    return c.json({ error: "no matching claim session" }, 400);
  }
  if (s.status !== "approved") return c.json({ error: `session is ${s.status}` }, 409);
  const { subHash, authTime, expiry, sig } = s.result;
  try {
    const txHash = await executeWithApproval(s.claimId, subHash as Hex, authTime!, expiry!, sig as Hex);
    return c.json({ txHash });
  } catch (err) {
    return c.json({ error: (err as Error).message.split("\n")[0] }, 500);
  }
});

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`surety-backend listening on :${info.port} (public ${config.publicUrl})`);
  });
}
