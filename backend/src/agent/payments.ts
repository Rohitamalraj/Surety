import { decodeEventLog, formatUnits, isAddress, parseUnits, type Address, type Hex } from "viem";
import { normalize } from "viem/ens";
import { config } from "../config.js";
import { abis, addr, agentAccount, chain, publicClient, readPolicy, readViolation, walletFor } from "../chain/contracts.js";
import { labelForNode } from "../chain/labels.js";
import { describeRevert, swapArgs } from "./simulator.js";

/**
 * The hosted payments agent: a Groq-hosted LLM that reads its rules from its own ENS name and acts
 * with the hosted agent key — paying through AgentVault and swapping through the Uniswap v4 pool
 * (where SuretyHook enforces the rules). It also reads an inbox that anyone can write to, the way a
 * real ops agent reads vendor email. It is a real agent: a persuasive inbox message can talk it into
 * breaking its rules. Swaps that break them are reverted by the hook; transfers are recorded, flagged
 * by the ViolationOracle and claimable — exactly the risk Surety insures. Nothing here is scripted.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentAction {
  type: "pay" | "swap";
  to: Address;
  amount: string; // USDC base units
  memo?: string;
  txHash?: Hex;
  paymentId?: string;
  violation?: string;
  /** swap only */
  amountOut?: string;
  blockedByHook?: boolean;
  revertReason?: string;
  error?: string;
}

export interface InboxMessage {
  id: number;
  from: string;
  subject: string;
  body: string;
  receivedAt: number;
  read: boolean;
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const USDC = 6;
const MAX_STEPS = 6;
const MIN_GAS_WEI = 300_000_000_000_000n; // 0.0003 ETH — a few transactions' worth

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_policy",
      description: "Read this agent's current insurance policy: its ENS-published rules, vault balance and totals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_inbox",
      description: "Read unread messages sent to this agent by vendors, partners and the policyholder's contacts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "pay",
      description: "Send USDC from the agent's vault to a counterparty. Executes a real on-chain payment immediately.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address, 0x-prefixed" },
          amount_usdc: { type: "number", description: "Amount in USDC, e.g. 2.5" },
          memo: { type: "string", description: "What the payment is for" },
        },
        required: ["to", "amount_usdc"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "swap",
      description:
        "Swap USDC from the vault into WETH through the vault's Uniswap v4 pool, settling to a counterparty. Executes a real on-chain swap immediately.",
      parameters: {
        type: "object",
        properties: {
          counterparty: { type: "string", description: "Who the swap settles to, 0x-prefixed" },
          amount_usdc: { type: "number", description: "USDC to sell, e.g. 1" },
          memo: { type: "string", description: "What the swap is for" },
        },
        required: ["counterparty", "amount_usdc"],
        additionalProperties: false,
      },
    },
  },
] as const;

export const hostedAgentAddress = (): Address | null => {
  try {
    return agentAccount().address;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- inbox

const inboxes = new Map<string, InboxMessage[]>();
let nextMessageId = 1;
const MAX_INBOX = 50;

/** Anyone can message an agent — that's what makes inbox injection a real attack surface. */
export function deliver(node: Hex, msg: { from: string; subject: string; body: string }): InboxMessage {
  const list = inboxes.get(node.toLowerCase()) ?? [];
  const m: InboxMessage = {
    id: nextMessageId++,
    from: msg.from.slice(0, 120),
    subject: msg.subject.slice(0, 200),
    body: msg.body.slice(0, 4000),
    receivedAt: Math.floor(Date.now() / 1000),
    read: false,
  };
  list.push(m);
  inboxes.set(node.toLowerCase(), list.slice(-MAX_INBOX));
  return m;
}

export const inbox = (node: Hex) => inboxes.get(node.toLowerCase()) ?? [];

function readUnread(node: Hex) {
  const unread = inbox(node).filter((m) => !m.read);
  for (const m of unread) m.read = true;
  return unread.map(({ from, subject, body, receivedAt }) => ({ from, subject, body, receivedAt: new Date(receivedAt * 1000).toISOString() }));
}

// ---------------------------------------------------------------- rules

/** The rules as published: ENS text records (resolved fresh), plus live vault and policy state. */
export async function readRules(node: Hex) {
  const [policy, label, balance] = await Promise.all([
    readPolicy(node),
    labelForNode(node),
    publicClient.readContract({ address: addr("AgentVault"), abi: abis.vault, functionName: "balanceOf", args: [node] }),
  ]);
  let allowlist: string[] = [];
  let ensName: string | null = null;
  let resolver: Address | null = null;
  if (label) {
    ensName = `${label}.surety.eth`;
    const name = normalize(ensName);
    const [raw, r] = await Promise.all([
      publicClient.getEnsText({ name, key: "surety.allowlist" }).catch(() => null),
      publicClient.getEnsResolver({ name }).catch(() => null),
    ]);
    allowlist = (raw ?? "").split(/[\s,]+/).filter((a) => isAddress(a));
    resolver = r;
  }
  return {
    ensName,
    resolver,
    policyholder: policy.policyholder,
    agent: policy.agent,
    perTxCap: formatUnits(policy.perTxCap, USDC),
    coverage: formatUnits(policy.coverageLimit, USDC),
    paidOut: formatUnits(policy.paidOut, USDC),
    vaultBalance: formatUnits(balance, USDC),
    allowlist,
    active: policy.active,
  };
}

/**
 * An operations-assistant role, the way agents are actually deployed: it handles the policyholder's
 * requests and vendor mail, and knows its published rules. It is never told to obey inbox senders.
 */
function systemPrompt(rules: Awaited<ReturnType<typeof readRules>>) {
  return [
    `You are the payments and treasury operations agent for ${rules.ensName ?? "an insured Surety policy"}, acting for the policyholder ${rules.policyholder}.`,
    "You pay merchants and vendors in USDC from an on-chain vault on Sepolia, and can swap USDC to WETH through the vault's Uniswap v4 pool.",
    "Requests reach you from the policyholder in chat and from vendors and partners through your inbox (read_inbox). The policyholder expects vendor requests to be handled promptly.",
    `Your policy's published rules (ENS): per-transaction cap ${rules.perTxCap} USDC; allowed counterparties: ${
      rules.allowlist.length ? rules.allowlist.join(", ") : "none published"
    }. Vault balance: ${rules.vaultBalance} USDC.`,
    "Use the tools to act; never say something was paid or swapped unless the tool returned a transaction. Keep replies to one or two short sentences and say what you did.",
  ].join("\n");
}

async function groq(messages: GroqMessage[]): Promise<GroqMessage> {
  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.groq.apiKey}` },
    body: JSON.stringify({ model: config.groq.model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.3 }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message: GroqMessage }[];
    error?: { message?: string };
  };
  if (!res.ok || !body.choices?.[0]) throw new Error(`Groq: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body.choices[0].message;
}

// ---------------------------------------------------------------- actions

async function preflight(node: Hex, amount: bigint): Promise<string | null> {
  const [balance, gas] = await Promise.all([
    publicClient.readContract({ address: addr("AgentVault"), abi: abis.vault, functionName: "balanceOf", args: [node] }),
    publicClient.getBalance({ address: agentAccount().address }),
  ]);
  if (amount > balance) return `vault holds only ${formatUnits(balance, USDC)} USDC`;
  if (gas < MIN_GAS_WEI) return "agent key is out of gas ETH";
  return null;
}

async function pay(node: Hex, to: string, amountUsdc: number, memo?: string): Promise<AgentAction> {
  const action: AgentAction = { type: "pay", to: to as Address, amount: "0", memo };
  if (!isAddress(to)) return { ...action, error: "invalid recipient address" };
  if (!(amountUsdc > 0)) return { ...action, error: "amount must be positive" };
  const amount = parseUnits(amountUsdc.toFixed(USDC), USDC);
  action.amount = amount.toString();
  const blocked = await preflight(node, amount);
  if (blocked) return { ...action, error: blocked };

  const account = agentAccount();
  try {
    const txHash = await walletFor(account).writeContract({
      account,
      chain,
      address: addr("AgentVault"),
      abi: abis.vault,
      functionName: "pay",
      args: [node, to, amount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    let paymentId: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: abis.vault, data: log.data, topics: log.topics });
        if (ev.eventName === "PaymentMade") paymentId = ev.args.paymentId.toString();
      } catch {}
    }
    if (receipt.status !== "success") return { ...action, txHash, error: "transaction reverted" };
    const violation = paymentId ? await readViolation(BigInt(paymentId)) : undefined;
    return { ...action, txHash, paymentId, violation };
  } catch (e) {
    return { ...action, error: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message };
  }
}

/**
 * Swap through AgentVault → PoolManager → SuretyHook. If the hook rejects it, the attempt is still
 * broadcast (fixed gas) so the blocked swap exists on-chain as a failed transaction anyone can open.
 */
async function swap(node: Hex, counterparty: string, amountUsdc: number, memo?: string): Promise<AgentAction> {
  const action: AgentAction = { type: "swap", to: counterparty as Address, amount: "0", memo };
  if (!isAddress(counterparty)) return { ...action, error: "invalid counterparty address" };
  if (!(amountUsdc > 0)) return { ...action, error: "amount must be positive" };
  const amount = parseUnits(amountUsdc.toFixed(USDC), USDC);
  action.amount = amount.toString();
  const blocked = await preflight(node, amount);
  if (blocked) return { ...action, error: blocked };

  const account = agentAccount();
  const args = swapArgs(node, counterparty as Address, amount);
  let revert: { reason: string; byHook: boolean } | undefined;
  try {
    await publicClient.simulateContract({ account, address: addr("AgentVault"), abi: [...abis.vault, ...abis.hook], functionName: "swap", args });
  } catch (err) {
    revert = describeRevert(err);
  }
  if (revert && !revert.byHook) return { ...action, error: revert.reason };

  try {
    const txHash = await walletFor(account).writeContract({
      account,
      chain,
      address: addr("AgentVault"),
      abi: abis.vault,
      functionName: "swap",
      args,
      ...(revert ? { gas: 500_000n } : {}),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (revert) return { ...action, txHash, blockedByHook: true, revertReason: revert.reason };
    let amountOut: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: abis.vault, data: log.data, topics: log.topics });
        if (ev.eventName === "SwapExecuted") amountOut = ev.args.amountOut.toString();
      } catch {}
    }
    if (receipt.status !== "success") return { ...action, txHash, error: "transaction reverted" };
    return { ...action, txHash, amountOut };
  } catch (e) {
    return { ...action, error: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message };
  }
}

// ---------------------------------------------------------------- loop

const busy = new Set<string>();

/** One user turn: let the model call tools (at most MAX_STEPS), return its reply and what it did. */
export async function chat(node: Hex, history: ChatMessage[]): Promise<{ reply: string; actions: AgentAction[] }> {
  if (!config.groq.apiKey) throw new Error("GROQ_API_KEY is not set on the backend");
  if (busy.has(node)) throw new Error("the agent is still working on the previous message");
  busy.add(node);
  try {
    const rules = await readRules(node);
    const messages: GroqMessage[] = [{ role: "system", content: systemPrompt(rules) }, ...history];
    const actions: AgentAction[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const msg = await groq(messages);
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      if (!msg.tool_calls?.length) return { reply: msg.content ?? "", actions };

      for (const call of msg.tool_calls) {
        let result: unknown;
        try {
          const args = JSON.parse(call.function.arguments || "{}") as {
            to?: string;
            counterparty?: string;
            amount_usdc?: number;
            memo?: string;
          };
          if (call.function.name === "get_policy") result = await readRules(node);
          else if (call.function.name === "read_inbox") {
            const unread = readUnread(node);
            result = unread.length ? { messages: unread } : { messages: [], note: "inbox is empty" };
          } else if (call.function.name === "pay") {
            const a = await pay(node, String(args.to ?? ""), Number(args.amount_usdc), args.memo);
            actions.push(a);
            result = a.error
              ? { ok: false, error: a.error }
              : { ok: true, txHash: a.txHash, paymentId: a.paymentId, recordedViolation: a.violation };
          } else if (call.function.name === "swap") {
            const a = await swap(node, String(args.counterparty ?? args.to ?? ""), Number(args.amount_usdc), args.memo);
            actions.push(a);
            result = a.error
              ? { ok: false, error: a.error }
              : a.blockedByHook
                ? { ok: false, blockedBy: "SuretyHook (Uniswap v4 beforeSwap)", reason: a.revertReason, txHash: a.txHash }
                : { ok: true, txHash: a.txHash, wethReceivedWei: a.amountOut };
          } else result = { error: `unknown tool ${call.function.name}` };
        } catch (e) {
          result = { error: (e as Error).message };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return { reply: "Stopped after too many steps.", actions };
  } finally {
    busy.delete(node);
  }
}
