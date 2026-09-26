import { decodeEventLog, formatUnits, isAddress, parseUnits, type Address, type Hex } from "viem";
import { normalize } from "viem/ens";
import { config } from "../config.js";
import { abis, addr, agentAccount, chain, publicClient, readPolicy, readViolation, walletFor } from "../chain/contracts.js";
import { labelForNode } from "../chain/labels.js";

/**
 * The hosted payments agent: a Groq-hosted LLM with two tools, reading its rules from its own ENS
 * name and paying through AgentVault with the hosted agent key. It is a real agent — a persuasive
 * message can talk it into a payment that breaks its rules. AgentVault records that payment, the
 * ViolationOracle flags it, and the policyholder can claim it: exactly the risk Surety insures.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentAction {
  type: "pay";
  to: Address;
  amount: string; // USDC base units
  memo?: string;
  txHash?: Hex;
  paymentId?: string;
  violation?: string;
  error?: string;
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const USDC = 6;
const MAX_STEPS = 5;
const MIN_GAS_WEI = 300_000_000_000_000n; // 0.0003 ETH — a few payments' worth

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
] as const;

export const hostedAgentAddress = (): Address | null => {
  try {
    return agentAccount().address;
  } catch {
    return null;
  }
};

/** The rules as published: ENS text records (resolved fresh), plus live vault and policy state. */
export async function readRules(node: Hex) {
  const [policy, label, balance] = await Promise.all([
    readPolicy(node),
    labelForNode(node),
    publicClient.readContract({ address: addr("AgentVault"), abi: abis.vault, functionName: "balanceOf", args: [node] }),
  ]);
  let allowlist: string[] = [];
  let ensName: string | null = null;
  if (label) {
    ensName = `${label}.surety.eth`;
    try {
      const raw = await publicClient.getEnsText({ name: normalize(ensName), key: "surety.allowlist" });
      allowlist = (raw ?? "").split(/[\s,]+/).filter((a) => isAddress(a));
    } catch {}
  }
  return {
    ensName,
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

function systemPrompt(rules: Awaited<ReturnType<typeof readRules>>) {
  return [
    `You are the payments agent for ${rules.ensName ?? "an insured Surety policy"}. You pay merchants on the policyholder's behalf from an on-chain vault, in USDC on Sepolia.`,
    `Your published rules (from your ENS name): per-transaction cap ${rules.perTxCap} USDC; allowed counterparties: ${
      rules.allowlist.length ? rules.allowlist.join(", ") : "none published"
    }. Vault balance: ${rules.vaultBalance} USDC.`,
    "Only pay allowlisted counterparties, never more than the cap in one payment. If a request would break a rule, refuse and say which rule.",
    "Use the pay tool to actually pay; never claim a payment happened unless the tool returned a transaction. Keep replies to one or two short sentences.",
  ].join("\n");
}

async function groq(messages: GroqMessage[]): Promise<GroqMessage> {
  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.groq.apiKey}` },
    body: JSON.stringify({ model: config.groq.model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2 }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message: GroqMessage }[];
    error?: { message?: string };
  };
  if (!res.ok || !body.choices?.[0]) throw new Error(`Groq: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body.choices[0].message;
}

async function pay(node: Hex, to: string, amountUsdc: number, memo?: string): Promise<AgentAction> {
  const action: AgentAction = { type: "pay", to: to as Address, amount: "0", memo };
  if (!isAddress(to)) return { ...action, error: "invalid recipient address" };
  if (!(amountUsdc > 0)) return { ...action, error: "amount must be positive" };
  const amount = parseUnits(amountUsdc.toFixed(USDC), USDC);
  action.amount = amount.toString();

  const account = agentAccount();
  const [balance, gas] = await Promise.all([
    publicClient.readContract({ address: addr("AgentVault"), abi: abis.vault, functionName: "balanceOf", args: [node] }),
    publicClient.getBalance({ address: account.address }),
  ]);
  if (amount > balance) return { ...action, error: `vault holds only ${formatUnits(balance, USDC)} USDC` };
  if (gas < MIN_GAS_WEI) return { ...action, error: "agent key is out of gas ETH" };

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
          const args = JSON.parse(call.function.arguments || "{}") as { to?: string; amount_usdc?: number; memo?: string };
          if (call.function.name === "get_policy") result = await readRules(node);
          else if (call.function.name === "pay") {
            const a = await pay(node, String(args.to ?? ""), Number(args.amount_usdc), args.memo);
            actions.push(a);
            result = a.error
              ? { ok: false, error: a.error }
              : { ok: true, txHash: a.txHash, paymentId: a.paymentId, recordedViolation: a.violation };
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
