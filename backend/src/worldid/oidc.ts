import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { config, redirectUri } from "../config.js";

/**
 * World ID for Agents (Human Continuity) OIDC client.
 * Confidential client, authorization code + PKCE S256, scope=openid exactly.
 * See https://sandbox.auth.world.org/llms.txt → guides `oidc` and `step-up`.
 */

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discovery: Discovery | undefined;
let jwks: JWTVerifyGetKey | undefined;

export async function getDiscovery(): Promise<Discovery> {
  if (!discovery) {
    const res = await fetch(`${config.worldId.issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    discovery = (await res.json()) as Discovery;
  }
  return discovery;
}

async function getJwks(): Promise<JWTVerifyGetKey> {
  if (!jwks) jwks = createRemoteJWKSet(new URL((await getDiscovery()).jwks_uri));
  return jwks;
}

/** Test hook: verify against a local key set instead of the IdP's. */
export function setJwksForTests(keys: JWTVerifyGetKey, disc: Discovery) {
  jwks = keys;
  discovery = disc;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function pkcePair() {
  const verifier = randomToken(48); // 64 chars, within 43–128
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * @param fresh require a brand-new World proof for this transaction (claim payout step-up).
 */
export async function buildAuthorizeUrl(opts: { state: string; nonce: string; codeChallenge: string; fresh: boolean }) {
  const { authorization_endpoint } = await getDiscovery();
  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.worldId.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    ...(opts.fresh ? { prompt: "login", max_age: "0", acr_values: config.worldId.acr } : {}),
  }).toString();
  return url.toString();
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const { token_endpoint } = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const { clientId, clientSecret, authMethod } = config.worldId;
  if (authMethod === "client_secret_post") {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  } else {
    const enc = (s: string) => encodeURIComponent(s);
    headers.Authorization = `Basic ${Buffer.from(`${enc(clientId)}:${enc(clientSecret)}`).toString("base64")}`;
  }

  const res = await fetch(token_endpoint, { method: "POST", headers, body });
  if (!res.ok) {
    // Never log the body or headers — they contain the code and credentials.
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("token response has no id_token");
  return json.id_token;
}

export interface WorldIdClaims extends JWTPayload {
  sub: string;
  auth_time: number;
  nonce?: string;
  acr?: string;
  amr?: string[];
}

/** Full validation: exact issuer, RS256 signature via JWKS, audience, expiry, nonce. */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<WorldIdClaims> {
  const { issuer } = await getDiscovery();
  const { payload } = await jwtVerify(idToken, await getJwks(), {
    issuer,
    audience: config.worldId.clientId,
    algorithms: ["RS256"],
    clockTolerance: config.clockSkewSec,
    requiredClaims: ["sub", "auth_time", "exp", "iat"],
  });
  if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch");
  if (typeof payload.auth_time !== "number") throw new Error("missing auth_time");
  return payload as WorldIdClaims;
}

/**
 * Step-up freshness for max_age=0: the authentication must belong to this attempt —
 * no earlier than when we started it, not in the future, and within the session lifetime.
 * Never use `iat` for freshness (browser-session reuse keeps the original auth_time).
 */
export function isFreshForAttempt(authTime: number, attemptStartedAt: number, now = Math.floor(Date.now() / 1000)) {
  const skew = config.clockSkewSec;
  return authTime >= attemptStartedAt - skew && authTime <= now + skew && now - authTime <= config.sessionTtlSec;
}
