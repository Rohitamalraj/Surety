import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Account,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { foundry, sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config, type ContractName } from "../config.js";
import { signerAccount } from "../worldid/signer.js";

/**
 * Minimal ABIs for the calls the backend makes. Replace with the generated ABIs from
 * `npm run abi:export` (Person A) once they land in src/abi/.
 */
const T_POLICY =
  "(address policyholder,address agent,address payoutAddr,uint256 coverageLimit,uint256 perTxCap,uint8 tier,uint32 streak,uint32 claimsCount,bytes32 subHash,uint256 paidOut,uint64 issuedAt,bool active)";
const T_CLAIM = "(bytes32 node,uint256 paymentId,uint8 vtype,uint256 amount,uint8 status,uint64 filedAt)";
const T_POOLKEY = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const T_SWAP = "(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96)";

export const abis = {
  registry: parseAbi([
    `function getPolicy(bytes32 node) view returns (${T_POLICY})`,
    "function isAllowed(bytes32 node, address counterparty) view returns (bool)",
    "function totalCoverage() view returns (uint256)",
    "event PolicyIssued(bytes32 indexed node, address indexed policyholder, address agent, uint256 coverageLimit, uint256 perTxCap, uint8 tier, uint256 premium)",
    "event StreakUpdated(bytes32 indexed node, uint32 streak)",
    "event PolicyExhausted(bytes32 indexed node)",
  ]),
  vault: parseAbi([
    "function pay(bytes32 node, address to, uint256 amount) returns (uint256)",
    `function swap(bytes32 node, ${T_POOLKEY} key, ${T_SWAP} params, address counterparty)`,
    "function getPayment(uint256 paymentId) view returns ((bytes32 node,address to,uint256 amount,uint64 timestamp))",
    "event Deposited(bytes32 indexed node, uint256 amount)",
    "event PaymentMade(bytes32 indexed node, uint256 indexed paymentId, address to, uint256 amount)",
    "event SwapExecuted(bytes32 indexed node, uint256 amountIn, uint256 amountOut)",
  ]),
  hook: parseAbi([
    "function liquidReserve() view returns (uint256)",
    "error PolicyViolation(bytes32 node, uint8 reason)",
    "event PremiumDeposited(bytes32 indexed node, uint256 amount)",
    "event BackingDeposited(address indexed backer, uint256 amount)",
    "event PayoutReleased(uint256 indexed claimId, address to, uint256 amount)",
  ]),
  oracle: parseAbi(["function check(uint256 paymentId) view returns (uint8)"]),
  gate: parseAbi(["event ClaimApproved(uint256 indexed claimId, uint64 authTime)"]),
  router: parseAbi([
    `function getClaim(uint256 claimId) view returns (${T_CLAIM})`,
    "function fileClaim(bytes32 node, uint256 paymentId) returns (uint256)",
    "function markHeld(uint256 claimId, string reason)",
    "function executeWithApproval(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry, bytes sig)",
    "event ClaimFiled(uint256 indexed claimId, bytes32 indexed node, uint256 paymentId, uint8 vtype, uint256 amount)",
    "event ClaimHeld(uint256 indexed claimId, string reason)",
    "event ClaimPaid(uint256 indexed claimId, address to, uint256 amount)",
    "event ClaimRejected(uint256 indexed claimId, string reason)",
    // ClaimRouter errors
    "error NotPolicyholder()",
    "error PolicyInactive()",
    "error PaymentNodeMismatch()",
    "error PaymentAlreadyClaimed(uint256 paymentId)",
    "error NoViolation(uint256 paymentId)",
    "error NothingToPay()",
    "error NotBackend()",
    "error ClaimNotOpen(uint256 claimId)",
    "error NotApproved(uint256 claimId)",
    // WorldIdGate errors, bubbled up through executeWithApproval
    "error InvalidSignature()",
    "error Expired()",
    "error AlreadyApproved(uint256 claimId)",
    "error SubjectMismatch()",
    "error StaleAuthentication()",
  ]),
} as const;

export const ClaimStatus = ["None", "Pending", "Held", "Paid", "Rejected"] as const;
export const ViolationType = ["None", "CapBreach", "OffAllowlist", "Attested"] as const;

export const chain = config.network === "local" ? foundry : sepolia;
const transport = () => http(config.chain.rpcUrl || undefined);

export const publicClient = createPublicClient({ chain, transport: transport() });

const wallets = new Map<string, WalletClient>();
export function walletFor(account: Account): WalletClient {
  let w = wallets.get(account.address);
  if (!w) {
    w = createWalletClient({ account, chain, transport: transport() });
    wallets.set(account.address, w);
  }
  return w;
}

export function agentAccount(): Account {
  if (!config.chain.agentPk) throw new Error("AGENT_PK is not set");
  return privateKeyToAccount(config.chain.agentPk);
}

export function isDeployed(): boolean {
  return !!(config.deployments.ClaimRouter && config.deployments.PolicyRegistry && config.deployments.AgentVault);
}

export function addr(name: ContractName): Address {
  const a = config.deployments[name];
  if (!a) throw new Error(`${name} address missing from deployments/${config.network}.json`);
  return a;
}

export async function readClaim(claimId: bigint) {
  return publicClient.readContract({ address: addr("ClaimRouter"), abi: abis.router, functionName: "getClaim", args: [claimId] });
}

export async function readPolicy(node: Hex) {
  return publicClient.readContract({ address: addr("PolicyRegistry"), abi: abis.registry, functionName: "getPolicy", args: [node] });
}

export async function readViolation(paymentId: bigint) {
  const v = await publicClient.readContract({ address: addr("ViolationOracle"), abi: abis.oracle, functionName: "check", args: [paymentId] });
  return ViolationType[v];
}

export async function markHeld(claimId: bigint, reason: string): Promise<Hex> {
  const w = walletFor(signerAccount());
  return w.writeContract({
    account: w.account!,
    chain,
    address: addr("ClaimRouter"),
    abi: abis.router,
    functionName: "markHeld",
    args: [claimId, reason],
  });
}

export async function executeWithApproval(
  claimId: bigint,
  subHash: Hex,
  authTime: number,
  expiry: number,
  sig: Hex,
): Promise<Hex> {
  const w = walletFor(signerAccount());
  return w.writeContract({
    account: w.account!,
    chain,
    address: addr("ClaimRouter"),
    abi: abis.router,
    functionName: "executeWithApproval",
    args: [claimId, subHash, BigInt(authTime), BigInt(expiry), sig],
  });
}
