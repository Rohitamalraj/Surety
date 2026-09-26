import { decodeFunctionData, toFunctionSelector, type Hex } from "viem";
import { namehash } from "viem/ens";
import { config } from "../config.js";
import { abis, publicClient } from "./contracts.js";
import { feed } from "../indexer/watchEvents.js";

/**
 * `issuePolicy` doesn't emit the label, so read it from the purchase tx's calldata (cached; never
 * changes). Smart accounts (e.g. MetaMask's EIP-7702 delegation) wrap the call, so look for the
 * embedded `issuePolicy` selector anywhere in the input, not just at the start. A decoded label is
 * only accepted if it namehashes back to the policy's node.
 */
const ISSUE_SELECTOR = toFunctionSelector("issuePolicy((string,address,address,uint256,uint256,address[],uint8),bytes32,uint64,bytes)").slice(2);
const labels = new Map<string, string | null>();

export async function labelOf(txHash: Hex, node: Hex): Promise<string | null> {
  if (labels.has(txHash)) return labels.get(txHash)!;
  let label: string | null = null;
  try {
    const input = (await publicClient.getTransaction({ hash: txHash })).input.slice(2);
    for (let i = input.indexOf(ISSUE_SELECTOR); i !== -1 && label === null; i = input.indexOf(ISSUE_SELECTOR, i + 1)) {
      if (i % 2 !== 0) continue;
      try {
        const call = decodeFunctionData({ abi: abis.registry, data: `0x${input.slice(i)}` });
        if (call.functionName === "issuePolicy" && namehash(`${call.args[0].label}.surety.eth`) === node.toLowerCase()) label = call.args[0].label;
      } catch {}
    }
  } catch {}
  labels.set(txHash, label);
  return label;
}

/** The ENS label of a policy node, from its PolicyIssued event (falls back to the demo block). */
export async function labelForNode(node: Hex): Promise<string | undefined> {
  const issued = feed({ node, limit: 500 }).find((e) => e.type === "PolicyIssued");
  const fromTx = issued ? await labelOf(issued.txHash, node) : null;
  return fromTx ?? (config.deployments.demo?.node === node ? config.deployments.demo.label : undefined);
}
