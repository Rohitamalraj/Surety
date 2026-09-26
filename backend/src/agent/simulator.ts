import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  decodeEventLog,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { config } from "../config.js";
import { abis, addr, agentAccount, chain, publicClient, readPolicy, walletFor } from "../chain/contracts.js";

/**
 * The insured agent, scripted for the demo (PRD §16.1, §23):
 *   normal       → a within-policy payment to an allowlisted merchant
 *   attack-swap  → the Grok/Bankr-style manipulated swap — blocked by SuretyHook.beforeSwap
 *   violation    → an over-cap transfer that slips through the vault — the insured event
 */
export type Step = "normal" | "attack-swap" | "violation";

export interface StepResult {
  step: Step;
  txHash?: Hex;
  reverted: boolean;
  revertReason?: string;
  paymentId?: string;
  amount?: string;
  to?: Address;
}

const USDC = (n: string) => parseUnits(n, 6);

function demo() {
  const d = config.deployments.demo;
  if (!d) throw new Error(`no "demo" block in deployments/${config.network}.json — run the seed script`);
  return d;
}

export async function runStep(step: Step, nodeOverride?: Hex): Promise<StepResult> {
  const d = demo();
  const node = nodeOverride ?? d.node;
  const policy = await readPolicy(node);

  if (step === "normal") return pay(step, node, d.merchant, policy.perTxCap / 5n || USDC("50"));
  if (step === "violation") return pay(step, node, d.merchant, (policy.perTxCap * 8n) / 5n);
  return attackSwap(node, d.attacker, policy.perTxCap * 20n);
}

async function pay(step: Step, node: Hex, to: Address, amount: bigint): Promise<StepResult> {
  const w = walletFor(agentAccount());
  const txHash = await w.writeContract({
    account: w.account!,
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
  return { step, txHash, reverted: receipt.status !== "success", paymentId, amount: amount.toString(), to };
}

/**
 * Simulates first to capture the hook's revert reason, then broadcasts anyway with a fixed gas
 * limit so the blocked attempt exists on-chain as a failed transaction judges can open.
 */
async function attackSwap(node: Hex, counterparty: Address, amount: bigint): Promise<StepResult> {
  const account = agentAccount();
  const pool = config.deployments.pool;
  const key = {
    currency0: pool?.currency0 ?? "0x0000000000000000000000000000000000000000",
    currency1: pool?.currency1 ?? addr("AgentVault"),
    fee: pool?.fee ?? 3000,
    tickSpacing: pool?.tickSpacing ?? 60,
    hooks: config.deployments.SuretyHook ?? "0x0000000000000000000000000000000000000000",
  } as const;
  const params = { zeroForOne: true, amountSpecified: -amount, sqrtPriceLimitX96: 4295128740n } as const;
  const args = [node, key, params, counterparty] as const;

  let revertReason: string | undefined;
  try {
    await publicClient.simulateContract({ account, address: addr("AgentVault"), abi: [...abis.vault, ...abis.hook], functionName: "swap", args });
  } catch (err) {
    revertReason = describeRevert(err);
  }
  if (!revertReason) {
    return { step: "attack-swap", reverted: false, revertReason: "NOT BLOCKED — hook enforcement is off", amount: amount.toString(), to: counterparty };
  }

  const w = walletFor(account);
  const txHash = await w.writeContract({
    account,
    chain,
    address: addr("AgentVault"),
    abi: abis.vault,
    functionName: "swap",
    args,
    gas: 500_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { step: "attack-swap", txHash, reverted: true, revertReason, amount: amount.toString(), to: counterparty };
}

const blockedMessage = (reason: number) =>
  reason === 1
    ? "Blocked: over per-transaction cap"
    : reason === 2
      ? "Blocked: counterparty not on allowlist"
      : "Blocked: policy violation";

function describeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const data = revert?.data;
    if (data?.errorName === "PolicyViolation") return blockedMessage(Number(data.args?.[1]));
    // The real v4 PoolManager wraps hook reverts: WrappedError(hook, selector, reason, details).
    if (data?.errorName === "WrappedError") {
      try {
        const inner = decodeErrorResult({ abi: abis.hook, data: data.args?.[2] as Hex });
        if (inner.errorName === "PolicyViolation") return blockedMessage(Number(inner.args?.[1]));
        return `Blocked by hook: ${inner.errorName}`;
      } catch {
        return "Blocked by hook";
      }
    }
    if (revert) return revert.reason ?? data?.errorName ?? revert.shortMessage;
    return err.shortMessage;
  }
  return String(err);
}
