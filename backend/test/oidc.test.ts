import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createHash } from "node:crypto";
import { config } from "../src/config.js";
import { isFreshForAttempt, pkcePair, setJwksForTests, verifyIdToken } from "../src/worldid/oidc.js";
import { hashSub } from "../src/worldid/signer.js";

const ISSUER = "https://sandbox.auth.world.org";
let key: CryptoKey;
const now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  (config.worldId as { clientId: string }).clientId = "client-123";
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  setJwksForTests(createLocalJWKSet({ keys: [jwk] }), {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/v1/authorize`,
    token_endpoint: `${ISSUER}/api/v1/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  });
});

function token(overrides: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: number } = {}) {
  return new SignJWT({ nonce: "n-1", auth_time: now(), acr: "https://world.org/oidc/acr/orb-v3", amr: ["pop"], ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? "client-123")
    .setSubject("pairwise-sub-abc")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? now() + 300)
    .sign(key);
}

describe("verifyIdToken", () => {
  it("accepts a valid token", async () => {
    const claims = await verifyIdToken(await token(), "n-1");
    expect(claims.sub).toBe("pairwise-sub-abc");
  });

  it("rejects wrong nonce (token from another attempt)", async () => {
    await expect(verifyIdToken(await token(), "n-2")).rejects.toThrow(/nonce/);
  });

  it("rejects wrong audience", async () => {
    await expect(verifyIdToken(await token({}, { aud: "other-client" }), "n-1")).rejects.toThrow();
  });

  it("rejects wrong issuer", async () => {
    await expect(verifyIdToken(await token({}, { iss: "https://evil.example" }), "n-1")).rejects.toThrow();
  });

  it("rejects expired token", async () => {
    await expect(verifyIdToken(await token({}, { exp: now() - 600 }), "n-1")).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ nonce: "n-1", auth_time: now() })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience("client-123")
      .setSubject("pairwise-sub-abc")
      .setIssuedAt()
      .setExpirationTime(now() + 300)
      .sign(other.privateKey);
    await expect(verifyIdToken(forged, "n-1")).rejects.toThrow();
  });

  it("rejects a token without auth_time", async () => {
    await expect(verifyIdToken(await token({ auth_time: undefined }), "n-1")).rejects.toThrow();
  });
});

describe("isFreshForAttempt", () => {
  const started = 1_800_000_000;
  it("accepts auth during the attempt", () => expect(isFreshForAttempt(started + 20, started, started + 40)).toBe(true));
  it("rejects a reused older session", () => expect(isFreshForAttempt(started - 3600, started, started + 40)).toBe(false));
  it("rejects future auth_time", () => expect(isFreshForAttempt(started + 600, started, started + 40)).toBe(false));
  it("rejects auth older than the session ttl", () =>
    expect(isFreshForAttempt(started + 5, started, started + 5 + config.sessionTtlSec + 1)).toBe(false));
});

describe("helpers", () => {
  it("pkce challenge is base64url sha256 of verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("hashSub is deterministic and hides the raw sub", () => {
    expect(hashSub("abc")).toBe(hashSub("abc"));
    expect(hashSub("abc")).not.toContain("abc");
    expect(hashSub("abc")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
