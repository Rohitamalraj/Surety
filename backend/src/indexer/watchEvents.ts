import type { AbiEvent, Address, Hex, Log } from "viem";
import { config, type ContractName } from "../config.js";
import { createPublicClient, http } from "viem";
import { abis, chain, isDeployed } from "../chain/contracts.js";
import { jsonSafe } from "../lib/json.js";

/**
 * Plain viem event listener → in-memory feed (PRD §16.1). No database: on restart it backfills
 * from the deploy block. Every purchase, payment, violation, claim and payout is a public event,
 * so the feed is reproducible by anyone from a block explorer.
 */

export interface FeedEvent {
  id: string; // txHash:logIndex
  type: string; // event name, e.g. ClaimPaid
  contract: ContractName;
  block: number;
  timestamp: number;
  txHash: Hex;
  node?: Hex;
  claimId?: string;
  paymentId?: string;
  data: Record<string, unknown>;
}

const SOURCES: [ContractName, readonly unknown[]][] = [
  ["PolicyRegistry", abis.registry],
  ["AgentVault", abis.vault],
  ["SuretyHook", abis.hook],
  ["WorldIdGate", abis.gate],
  ["ClaimRouter", abis.router],
];

const CHUNK = 2_000n;

/** Separate client for indexing — see config.chain.indexerRpcUrl. */
const publicClient = createPublicClient({ chain, transport: http(config.chain.indexerRpcUrl) });
const events: FeedEvent[] = [];
const seen = new Set<string>();
const blockTimes = new Map<bigint, number>();
let nextBlock = config.chain.deployBlock;
let running = false;
let lastError: string | undefined;


function contractOf(address: Address): ContractName | undefined {
  const a = address.toLowerCase();
  return SOURCES.find(([name]) => config.deployments[name]?.toLowerCase() === a)?.[0];
}

async function timestampOf(block: bigint) {
  let t = blockTimes.get(block);
  if (t === undefined) {
    t = Number((await publicClient.getBlock({ blockNumber: block })).timestamp);
    blockTimes.set(block, t);
  }
  return t;
}

async function ingest(logs: (Log & { eventName?: string; args?: Record<string, unknown> })[]) {
  for (const log of logs) {
    const id = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(id) || !log.eventName || !log.args || log.blockNumber === null) continue;
    const contract = contractOf(log.address);
    if (!contract) continue;
    const args = log.args;
    seen.add(id);
    events.push({
      id,
      type: log.eventName,
      contract,
      block: Number(log.blockNumber),
      timestamp: await timestampOf(log.blockNumber),
      txHash: log.transactionHash!,
      node: args.node as Hex | undefined,
      claimId: args.claimId?.toString(),
      paymentId: args.paymentId?.toString(),
      data: jsonSafe(args) as Record<string, unknown>,
    });
  }
  events.sort((a, b) => a.block - b.block || a.id.localeCompare(b.id));
}

async function poll() {
  const addresses = SOURCES.map(([name]) => config.deployments[name]).filter(Boolean) as Address[];
  const allEvents = SOURCES.flatMap(([, abi]) => abi.filter((x) => (x as AbiEvent).type === "event")) as AbiEvent[];
  const latest = await publicClient.getBlockNumber();
  while (nextBlock <= latest) {
    const to = nextBlock + CHUNK - 1n < latest ? nextBlock + CHUNK - 1n : latest;
    const logs = await publicClient.getLogs({ address: addresses, events: allEvents, fromBlock: nextBlock, toBlock: to });
    await ingest(logs as Parameters<typeof ingest>[0]);
    nextBlock = to + 1n;
  }
}

export function startIndexer() {
  if (running || !isDeployed()) return;
  running = true;
  const tick = async () => {
    try {
      await poll();
      lastError = undefined;
    } catch (err) {
      lastError = (err as Error).message.split("\n")[0];
    }
    setTimeout(tick, config.chain.pollMs).unref();
  };
  void tick();
}

/** Await one full catch-up pass (tests, and routes that must reflect a tx that just landed). */
export async function syncNow() {
  if (isDeployed()) await poll();
}

export function indexerStatus() {
  return { running, nextBlock: nextBlock.toString(), events: events.length, lastError };
}

export function feed(opts: { node?: string; limit?: number } = {}): FeedEvent[] {
  const node = opts.node?.toLowerCase();
  const list = node ? events.filter((e) => e.node?.toLowerCase() === node || claimNode(e) === node) : events;
  return list.slice(-(opts.limit ?? 50)).reverse();
}

/** Claim events other than ClaimFiled don't carry the node; resolve it from the filing. */
function claimNode(e: FeedEvent): string | undefined {
  if (!e.claimId) return undefined;
  return events.find((f) => f.type === "ClaimFiled" && f.claimId === e.claimId)?.node?.toLowerCase();
}

export function paymentEvents(node: string) {
  return events.filter((e) => e.type === "PaymentMade" && e.node?.toLowerCase() === node.toLowerCase());
}

export function claimIdsFor(node: string) {
  return events
    .filter((e) => e.type === "ClaimFiled" && e.node?.toLowerCase() === node.toLowerCase())
    .map((e) => BigInt(e.claimId!));
}
