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
 *   swap         → a within-policy USDC→WETH swap through the v4 pool — SuretyHook lets it trade
 *   attack-swap  → the Grok/Bankr-style manipulated swap — blocked by SuretyHook.beforeSwap
 *   violation    → an over-cap transfer that slips through the vault — the insured event
 */
export type Step = "normal" | "swap" | "attack-swap" | "violation";

export interface StepResult {
  step: Step;
  txHash?: Hex;
  reverted: boolean;
  revertReason?: string;
  /** attack-swap only: true when SuretyHook itself rejected the swap (not some earlier check). */
  blockedByHook?: boolean;
  paymentId?: string;
  amount?: string;
  /** swap only: WETH received, wei. */
  amountOut?: string;
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
  if (step === "swap") return compliantSwap(node, d.merchant, policy.perTxCap / 5n || USDC("1"));
  // "Send everything to the new address": 20x the cap, but never more than the agent holds —
  // AgentVault checks the balance before the pool runs, and the hook must be what stops it.
  const balance = await publicClient.readContract({ address: addr("AgentVault"), abi: abis.vault, functionName: "balanceOf", args: [node] });
  const want = policy.perTxCap * 20n;
  return attackSwap(node, d.attacker, want < balance ? want : balance);
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

/** A swap the policy allows: SuretyHook's beforeSwap passes it and the pool really trades. */
async function compliantSwap(node: Hex, counterparty: Address, amount: bigint): Promise<StepResult> {
  const w = walletFor(agentAccount());
  const txHash = await w.writeContract({
    account: w.account!,
    chain,
    address: addr("AgentVault"),
    abi: abis.vault,
    functionName: "swap",
    args: swapArgs(node, counterparty, amount),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  let amountOut: string | undefined;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: abis.vault, data: log.data, topics: log.topics });
      if (ev.eventName === "SwapExecuted") amountOut = ev.args.amountOut.toString();
    } catch {}
  }
  return { step: "swap", txHash, reverted: receipt.status !== "success", amount: amount.toString(), amountOut, to: counterparty };
}

/**
 * Simulates first to capture the hook's revert reason, then broadcasts anyway with a fixed gas
 * limit so the blocked attempt exists on-chain as a failed transaction judges can open.
 */
async function attackSwap(node: Hex, counterparty: Address, amount: bigint): Promise<StepResult> {
  const account = agentAccount();
  const args = swapArgs(node, counterparty, amount);

  let revert: { reason: string; byHook: boolean } | undefined;
  try {
    await publicClient.simulateContract({ account, address: addr("AgentVault"), abi: [...abis.vault, ...abis.hook], functionName: "swap", args });
  } catch (err) {
    revert = describeRevert(err);
  }
  const base = { step: "attack-swap" as const, amount: amount.toString(), to: counterparty };
  if (!revert) return { ...base, reverted: false, blockedByHook: false, revertReason: "NOT BLOCKED — hook enforcement is off" };
  // Only a hook rejection is worth an on-chain failed tx; anything else is a setup problem to surface.
  if (!revert.byHook) return { ...base, reverted: true, blockedByHook: false, revertReason: revert.reason };

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
  return { ...base, txHash, reverted: true, blockedByHook: true, revertReason: revert.reason };
}

/** Exact-input "sell `amount` MockUSDC" through the canonical pool, declaring `counterparty` to the hook. */
function swapArgs(node: Hex, counterparty: Address, amount: bigint) {
  const pool = config.deployments.pool;
  const key = {
    currency0: pool?.currency0 ?? "0x0000000000000000000000000000000000000000",
    currency1: pool?.currency1 ?? addr("AgentVault"),
    fee: pool?.fee ?? 3000,
    tickSpacing: pool?.tickSpacing ?? 60,
    hooks: config.deployments.SuretyHook ?? "0x0000000000000000000000000000000000000000",
  } as const;
  // Exact-input "sell USDC": direction depends on which side of the pool MockUSDC sorts to
  // (token0 on the anvil devnet, token1 against Sepolia WETH). Price limit = the far end.
  const zeroForOne = key.currency0.toLowerCase() === addr("MockUSDC").toLowerCase();
  const params = {
    zeroForOne,
    amountSpecified: -amount,
    sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
  } as const;
  return [node, key, params, counterparty] as const;
}

const blockedMessage = (reason: number) =>
  reason === 1
    ? "Blocked: over per-transaction cap"
    : reason === 2
      ? "Blocked: counterparty not on allowlist"
      : "Blocked: policy violation";

function describeRevert(err: unknown): { reason: string; byHook: boolean } {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const data = revert?.data;
    if (data?.errorName === "PolicyViolation") return { reason: blockedMessage(Number(data.args?.[1])), byHook: true };
    // The real v4 PoolManager wraps hook reverts: WrappedError(hook, selector, reason, details).
    if (data?.errorName === "WrappedError") {
      const byHook = String(data.args?.[0]).toLowerCase() === addr("SuretyHook").toLowerCase();
      try {
        const inner = decodeErrorResult({ abi: abis.hook, data: data.args?.[2] as Hex });
        if (inner.errorName === "PolicyViolation") return { reason: blockedMessage(Number(inner.args?.[1])), byHook };
        return { reason: `Reverted in hook: ${inner.errorName}`, byHook };
      } catch {
        return { reason: "Reverted in hook", byHook };
      }
    }
    if (revert) return { reason: data?.errorName ?? revert.reason ?? revert.shortMessage, byHook: false };
    return { reason: err.shortMessage, byHook: false };
  }
  return { reason: String(err), byHook: false };
}
