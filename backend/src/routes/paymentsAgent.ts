import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { config } from "../config.js";
import { publicClient, readPolicy } from "../chain/contracts.js";
import { chat, deliver, hostedAgentAddress, inbox, readRules, type ChatMessage } from "../agent/payments.js";
import { describeError } from "../lib/errors.js";

/**
 * The hosted payments agent. Anyone can read its address and a policy's rules; only the policyholder
 * can instruct it, proven by signing `sessionMessage` with their wallet (EIP-191, smart accounts via
 * ERC-1271/6492), and only for a policy whose agent key is the hosted one.
 */
export const paymentsAgent = new Hono();

const SESSION_TTL_MS = 60 * 60 * 1000;
const sessions = new Map<string, { node: Hex; address: Address; exp: number }>();

const isNode = (s: unknown): s is Hex => typeof s === "string" && isHex(s) && s.length === 66;

export const sessionMessage = (node: Hex, address: Address, issuedAt: string) =>
  `Surety: let the hosted payments agent act on my instructions\nPolicy: ${node}\nWallet: ${address}\nIssued: ${issuedAt}`;

paymentsAgent.get("/info", (c) =>
  c.json({ address: hostedAgentAddress(), enabled: !!config.groq.apiKey && !!hostedAgentAddress(), model: config.groq.model }),
);

paymentsAgent.get("/rules/:node", async (c) => {
  const node = c.req.param("node");
  if (!isNode(node)) return c.json({ error: "bad node" }, 400);
  try {
    return c.json(await readRules(node));
  } catch (e) {
    return c.json({ error: describeError(e) }, 500);
  }
});

paymentsAgent.post("/session", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { node?: string; address?: string; issuedAt?: string; signature?: string };
  const { node, address, issuedAt, signature } = body;
  if (!isNode(node) || !address || !isAddress(address) || !issuedAt || !signature || !isHex(signature)) {
    return c.json({ error: "node, address, issuedAt and signature are required" }, 400);
  }
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -60_000 && age <= 5 * 60_000)) return c.json({ error: "signature is too old; sign again" }, 400);

  const policy = await readPolicy(node);
  if (policy.policyholder.toLowerCase() !== address.toLowerCase()) return c.json({ error: "only the policyholder can instruct this agent" }, 403);
  const hosted = hostedAgentAddress();
  if (!hosted || policy.agent.toLowerCase() !== hosted.toLowerCase()) {
    return c.json({ error: "this policy's agent key isn't the hosted payments agent" }, 400);
  }
  const ok = await publicClient
    .verifyMessage({ address, message: sessionMessage(node, address, issuedAt), signature })
    .catch(() => false);
  if (!ok) return c.json({ error: "signature does not match the wallet" }, 401);

  const token = randomBytes(24).toString("hex");
  sessions.set(token, { node, address, exp: Date.now() + SESSION_TTL_MS });
  return c.json({ token, expiresAt: Date.now() + SESSION_TTL_MS });
});

paymentsAgent.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string; messages?: ChatMessage[] };
  const s = body.token ? sessions.get(body.token) : undefined;
  if (!s || s.exp < Date.now()) return c.json({ error: "session expired; sign in to the agent again" }, 401);

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return c.json({ error: "send a user message" }, 400);

  try {
    return c.json(await chat(s.node, messages));
  } catch (e) {
    return c.json({ error: describeError(e) }, 500);
  }
});

// ---------------------------------------------------------------- inbox (public: anyone can message an agent)

paymentsAgent.get("/inbox/:node", (c) => {
  const node = c.req.param("node");
  if (!isNode(node)) return c.json({ error: "bad node" }, 400);
  return c.json(inbox(node));
});

paymentsAgent.post("/inbox/:node", async (c) => {
  const node = c.req.param("node");
  if (!isNode(node)) return c.json({ error: "bad node" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { from?: string; subject?: string; body?: string };
  if (!body.body || typeof body.body !== "string") return c.json({ error: "body is required" }, 400);
  return c.json(deliver(node, { from: String(body.from ?? "unknown"), subject: String(body.subject ?? "(no subject)"), body: body.body }));
});
