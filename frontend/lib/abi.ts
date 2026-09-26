import { parseAbi } from "viem";

export const registryAbi = parseAbi([
  "struct IssueParams { string label; address agent; address payoutAddr; uint256 coverageLimit; uint256 perTxCap; address[] allowlist; uint8 tier; }",
  "function issuePolicy(IssueParams p, bytes32 subHash, uint64 expiry, bytes enrollSig) returns (bytes32)",
  "error EnrollmentInvalid()",
  "error InsufficientReserve(uint256 liquidReserve, uint256 required)",
]);

export const routerAbi = parseAbi([
  "function fileClaim(bytes32 node, uint256 paymentId) returns (uint256)",
  "event ClaimFiled(uint256 indexed claimId, bytes32 indexed node, uint256 paymentId, uint8 vtype, uint256 amount)",
  "error NotPolicyholder()",
  "error PolicyInactive()",
  "error PaymentNodeMismatch()",
  "error PaymentAlreadyClaimed(uint256 paymentId)",
  "error NoViolation(uint256 paymentId)",
  "error NothingToPay()",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);

export const hookAbi = parseAbi(["function depositBacking(uint256 amount)"]);

export const vaultAbi = parseAbi([
  "function deposit(bytes32 node, uint256 amount)",
  "function balanceOf(bytes32 node) view returns (uint256)",
]);

/** ENS resolver text() — resolver address is looked up fresh on every read (invariant 4). */
export const resolverAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
