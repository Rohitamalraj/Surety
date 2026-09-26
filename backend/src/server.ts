import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address, type Hex } from "viem";
import { config } from "./config.js";
import { abis, addr, executeWithApproval, isDeployed, publicClient } from "./chain/contracts.js";
import { buildAuthorizeUrl, exchangeCode, pkcePair, verifyIdToken, type WorldIdClaims } from "./worldid/oidc.js";
import { createSession, getSession, publicView, takeSessionByState, type Session } from "./worldid/sessions.js";
import { completeEnrollment } from "./worldid/verifyProofOfHuman.js";
import { completeClaimCheck, fail } from "./worldid/verifyFreshCheck.js";
import { startIndexer, syncNow } from "./indexer/watchEvents.js";
import { data } from "./routes/data.js";
import { idkit } from "./routes/idkit.js";
import { describeError } from "./lib/errors.js";

export const app = new Hono();

/**
 * Local devnet only, when no World ID client is configured: a mock IdP page so the full flow can
 * be exercised on anvil (World ID won't redirect to localhost). It feeds the same server-side
 * checks as the real flow. Never active on Sepolia.
 */
const useDevIdp = config.network === "local" && !config.worldId.clientId;
const DEV_SUB = "local-demo-sub"; // keccak256 matches the devnet policy's subHash

app.use("/api/*", cors({ origin: config.frontendUrl }));
app.use("/health", cors({ origin: config.frontendUrl }));

app.get("/health", async (c) => {
  let block: string | null = null;
  try {
    block = (await publicClient.getBlockNumber()).toString();
  } catch {}
  return c.json({
    ok: true,
    network: config.network,
    chainId: config.chain.chainId,
    block,
    worldId: useDevIdp ? "dev-mock" : config.worldId.clientId ? "configured" : "missing",
  });
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
    if (await needsProofOfHuman(address)) {
      return c.redirect(`${config.frontendUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}error=unique_human_required`, 302);
    }
    session = createSession({ purpose, address, returnTo, verifier });
  } else if (purpose === "claim") {
    const claimId = c.req.query("claimId");
    if (!claimId || !/^\d+$/.test(claimId)) return c.text("claimId required", 400);
    session = createSession({ purpose, claimId: BigInt(claimId), returnTo, verifier });
  } else {
    return c.text("purpose must be enroll or claim", 400);
  }

  if (useDevIdp) return c.redirect(`/auth/worldid/dev-idp?state=${session.state}`, 302);

  const url = await buildAuthorizeUrl({
    state: session.state,
    nonce: session.nonce,
    codeChallenge: challenge,
    fresh: purpose === "claim",
  });
  return c.redirect(url, 302);
});

/** IDKit alternative path: when the gate requires it, enrollment waits for proof of unique human. */
async function needsProofOfHuman(address: Address): Promise<boolean> {
  if (!isDeployed()) return false;
  const gate = addr("WorldIdGate");
  const required = await publicClient.readContract({ address: gate, abi: abis.gate, functionName: "requireUniqueHuman" });
  if (!required) return false;
  return !(await publicClient.readContract({ address: gate, abi: abis.gate, functionName: "isVerifiedHuman", args: [address] }));
}

const backToFrontend = (c: Context, s: Session) =>
  c.redirect(`${config.frontendUrl}/worldid/return?session=${s.id}`, 302);

/** Applies a validated World ID result (or failure) to the session. */
async function finish(session: Session, claims: WorldIdClaims) {
  if (session.purpose === "enroll") await completeEnrollment(session, claims);
  else await completeClaimCheck(session, claims);
}

app.get("/auth/worldid/callback", async (c) => {
  const state = c.req.query("state");
  const session = state ? takeSessionByState(state) : undefined;
  if (!session) return c.text("Unknown or already-used login attempt.", 400);

  if (session.status === "expired") {
    await fail(session, "expired", "login attempt expired");
    return backToFrontend(c, session);
  }

  const error = c.req.query("error");
  if (error) {
    await fail(session, error === "access_denied" ? "cancelled" : "denied", error);
    return backToFrontend(c, session);
  }

  const code = c.req.query("code");
  if (!code) {
    await fail(session, "denied", "no authorization code");
    return backToFrontend(c, session);
  }

  try {
    const idToken = await exchangeCode(code, session.verifier);
    await finish(session, await verifyIdToken(idToken, session.nonce));
  } catch (err) {
    await fail(session, "denied", (err as Error).message);
  }
  return backToFrontend(c, session);
});

if (useDevIdp) {
  app.get("/auth/worldid/dev-idp", (c) => {
    const state = c.req.query("state") ?? "";
    const link = (as: string, label: string) =>
      `<a href="/auth/worldid/dev-idp/complete?state=${encodeURIComponent(state)}&as=${as}">${label}</a>`;
    return c.html(`<!doctype html><meta charset="utf-8"><title>Mock World ID (local devnet)</title>
<style>body{font:16px system-ui;background:#0a0a0b;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:420px;padding:24px}a{display:block;margin:10px 0;padding:12px 18px;border-radius:999px;background:#f3ecdc;color:#111;text-decoration:none;text-align:center}
a.alt{background:#333;color:#eee}small{color:#999}</style>
<main><h2>Mock World ID</h2><small>Local devnet only — stands in for sandbox.auth.world.org. The backend still runs every server-side check.</small>
${link("holder", "Verify as the policyholder")}
${link("other", "Verify as a different person").replace("<a ", '<a class="alt" ')}
${link("cancel", "Cancel").replace("<a ", '<a class="alt" ')}</main>`);
  });

  app.get("/auth/worldid/dev-idp/complete", async (c) => {
    const session = takeSessionByState(c.req.query("state") ?? "");
    if (!session) return c.text("Unknown or already-used login attempt.", 400);
    const as = c.req.query("as");
    if (as === "cancel") {
      await fail(session, "cancelled", "access_denied");
    } else {
      const sub = as === "holder" ? DEV_SUB : `someone-else-${Date.now()}`;
      await finish(session, { sub, auth_time: Math.floor(Date.now() / 1000), nonce: session.nonce });
    }
    return backToFrontend(c, session);
  });
}

/** Frontend polls this after returning from World ID. */
app.get("/api/worldid/session/:id", (c) => {
  const s = getSession(c.req.param("id"));
  if (!s) return c.json({ error: "not found" }, 404);
  return c.json(publicView(s));
});

/** Relays an approved claim check on-chain in one tx: WorldIdGate.approveClaim + ClaimRouter.execute. */
app.post("/api/claims/:id/execute", async (c) => {
  const { session: sessionId } = await c.req.json<{ session?: string }>().catch(() => ({}) as { session?: string });
  const s = sessionId ? getSession(sessionId) : undefined;
  if (!s || s.purpose !== "claim" || s.claimId?.toString() !== c.req.param("id")) {
    return c.json({ error: "no matching claim session" }, 400);
  }
  if (s.status !== "approved") return c.json({ error: `session is ${s.status}` }, 409);
  const { subHash, authTime, expiry, sig } = s.result;
  try {
    const txHash = await executeWithApproval(s.claimId, subHash as Hex, authTime!, expiry!, sig as Hex);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    await syncNow();
    return c.json({ txHash });
  } catch (err) {
    return c.json({ error: describeError(err) }, 500);
  }
});

/** Network + contract addresses for the frontend (from deployments/<network>.json). */
app.get("/api/deployments", (c) =>
  c.json({ network: config.network, chainId: config.chain.chainId, ...config.deployments }),
);

// Registered last so the World ID routes above answer first.
app.route("/api/idkit", idkit);
app.route("/api", data);

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`surety-backend on :${info.port} — network=${config.network}, public ${config.publicUrl}`);
    if (useDevIdp) console.log("World ID: local mock IdP (no client configured)");
    startIndexer();
  });
}
