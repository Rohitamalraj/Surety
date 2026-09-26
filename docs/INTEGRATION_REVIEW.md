# ENS, Uniswap and World ID integration review

Follow-up: [DEEP_VERIFICATION.md](DEEP_VERIFICATION.md) records multi-user load, randomized ledger tests,
full Universal Resolver discovery and executable reproductions of the blockers below.

Reviewed 2026-09-26. Scope: Person A's chain layer, its identity/claims boundary, and the unfinished Sepolia fork tests. This is an integration review, not a security audit or production certification. Earlier architecture/progress notes describe intent as well as implementation; this document distinguishes them.

## What each component does

`PolicyRegistry.issuePolicy` verifies a backend enrollment attestation through `IWorldIdGate`, quotes the premium, transfers MockUSDC to the hook, creates a resolver proxy, publishes policy records, and registers the policy name. It stores the policy and allowlist locally and requires the liquid reserve to cover twice the outstanding coverage. Failure rolls back the issuance transaction.

Each policy has its own resolver proxy. The registry holds text/address setter and delegation permissions; the agent receives permission for the `surety.streak` key. Permission resources do not incorporate the name, so separate proxies are the isolation boundary. Registry token roles and resolver setter roles belong to different contracts.

`AgentVault` is one shared contract with a USDC balance per policy node. The policyholder deposits and withdraws; its agent spends. `pay` intentionally permits rule-breaking transfers and records recipient, amount and time. That record is evidence for a future claim, not payout authorization.

For swaps, the vault unlocks Uniswap's PoolManager, receives its callback, calls `swap`, and settles negative currency deltas with tokens. Positive deltas are taken into the vault. The hook sees the vault as the direct caller and checks the supplied policy, cap and counterparty. Empty hook data permits public swaps. The reserve is the hook's separate USDC balance, not pool liquidity; only its configured ClaimRouter can release it.

World ID is intended to establish human continuity off-chain. The specified backend verifies an identity result, binds it to enrollment or a claim, then signs a Surety EIP-712 attestation. The chain trusts that signer. World ID proof-request signing and Surety claim-attestation signing are separate responsibilities.

This checkout has no backend, frontend, production WorldIdGate, ClaimRouter or ViolationOracle implementation. Their interfaces are integration boundaries. `PricingEngine.sol` is marked as a placeholder pending Person B's version. `deployments/sepolia.json` is empty.

## Verified ENS read correction

At ENS commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`, PermissionedResolver inherits AbstractRecordResolver. It provides `setText(bytes,string,string)` for writes and `resolve(bytes,bytes)` for profile reads, but no callable `text(bytes32,string)`. An ABI interface cannot add that method to deployed bytecode.

```solidity
address resolver = IEnsRegistryReader(parentRegistry).getResolver(label);
bytes memory encoded = IEnsExtendedResolver(resolver).resolve(
    dnsName,
    abi.encodeCall(IEnsTextResolver.text, (node, "surety.status"))
);
string memory status = abi.decode(encoded, (string));
```

The DNS-wire name selects the record; this implementation ignores the nested profile's node argument. The Solidity call unwraps the outer ABI bytes; the explicit decode unwraps the profile result. Keep IEnsTextResolver for query encoding only.

The fork discovers the resolver through the parent registry on every read and checks that it matches the issuance event. This verifies the registration link as well as the records. Applications should use the Universal Resolver to traverse the current hierarchy and handle wildcard/CCIP-read behavior. The test's known-parent shortcut does not prove parent discovery or frontend resolution.

Sources: [AbstractRecordResolver](https://github.com/ensdomains/contracts-v2/blob/71a3b7339dbc55ab47667abdfe8303bac4f4c24e/contracts/src/resolver/AbstractRecordResolver.sol), [PermissionedResolver](https://github.com/ensdomains/contracts-v2/blob/71a3b7339dbc55ab47667abdfe8303bac4f4c24e/contracts/src/resolver/PermissionedResolver.sol), [IRegistry](https://github.com/ensdomains/contracts-v2/blob/71a3b7339dbc55ab47667abdfe8303bac4f4c24e/contracts/src/registry/interfaces/IRegistry.sol).

## World ID configuration

The supplied App ID and RP ID are recorded as public configuration in the root `.env.example`. No backend currently consumes them. The value labeled "signer address" has 64 hexadecimal digits (32 bytes); an Ethereum address has 40 (20 bytes). Its actual portal field must be identified. It has not been copied into configuration or assigned to BACKEND_SIGNER. If it was a signing key, rotate it in the portal before use.

Current World docs describe app_id, rp_id and a server-held signing key for IDKit RP requests. This does not establish that this particular RP is registered, valid or configured for a specific environment. The PRD separately specifies OIDC at sandbox.auth.world.org and IDKit as a stretch addition. That sandbox documentation endpoint was unavailable during review, so the older OIDC flow was not independently revalidated.

Person B must reconcile the chosen integration with the PRD: provision the correct server credentials, bind wallet/claim context, verify responses server-side, establish same-person continuity, enforce freshness and single-use approvals, and configure the Surety attestation signer. An IDKit nullifier is not automatically an OIDC pairwise sub. Generated ECDSA signatures in a test do not prove human verification.

Sources: [IDKit integration](https://docs.world.org/world-id/idkit/integrate), [RP signatures](https://docs.world.org/world-id/idkit/signatures), [human approval integration](https://docs.world.org/agents/human-in-the-loop/integrate).

## Production blockers found — status as of the 2026-09-26 fix pass

Five of the original nine chain-layer findings are now fixed in `AgentVault.sol`/`PolicyRegistry.sol` and
re-verified against the real fork (`contracts/test/fork/RealSepoliaFork.t.sol`, renamed from
`test_diagnostic_*` to `test_real_*`). The rest are unchanged and still block production use — mostly
because they depend on Person B's identity/claims contracts, which don't exist in this checkout.

| Priority | Status | Evidence and consequence | Fix / required acceptance evidence |
|---|---|---|---|
| Critical | **Fixed** | AgentVault.swap accepted arbitrary PoolKey hooks — an agent could route through a pool that never runs Surety enforcement. | `AgentVault` now stores an owner-pinned `canonicalPoolKey` (currencies, fee, tick spacing, **and hook**) and rejects any other `PoolKey` with `UnauthorizedPool`. `test_real_hooklessPoolIsRejectedByVault`. |
| High | **Fixed** | The vault deducted the *requested* input but Uniswap may only partially fill at a price limit, settling less. | `swap()` now debits the actually-settled USDC delta (read from `BalanceDelta` after the swap), never the pre-trade request. `test_real_partialFillCreditsOnlyActualSpend`. |
| High | **Fixed** | ENS status remained "active" after `recordPayout` exhausted a policy's coverage. | `recordPayout` now writes `surety.status = "exhausted"` on the policy's own resolver (tracked in a new `_resolvers`/`_dnsNames` mapping — not part of the locked `PolicyRecord` struct) when `paidOut >= coverageLimit`. `test_real_exhaustedPolicyPublishesStatusAndStillSpendsOwnBalance`. Continuing to allow the agent to spend its own already-deposited vault balance after exhaustion is intentional, not a defect: `coverageLimit` bounds future claim payouts, not vault custody. |
| High | **Fixed** | `_buildRecordCalls` published the agent's own EOA as the `addr` record; PRD §10.3 specifies AgentVault. | `PolicyRegistry` now takes an owner-set `agentVault` address (`setAgentVault`, wired post-deploy since AgentVault is deployed after PolicyRegistry) and publishes that. `issuePolicy` reverts `AgentVaultNotSet` until it's wired. `url` is still absent — no open item defines what URL to publish; deferred. |
| High | **Fixed** | `recordPayout` trusted the caller's `amount` outright — a buggy/compromised `ClaimRouter` could push one policy's `paidOut` past its own `coverageLimit`, corrupting the shared `totalCoverage` invariant every other policy's 2x reserve depends on. | `recordPayout` now bounds the credited amount at `coverageLimit - paidOut` before applying it. `test_real_recordPayoutBoundsToOwnRemainingCoverage`. |
| High | Open | Output tokens accumulate in the shared vault without per-node accounting or output withdrawal. Counterparty is caller-supplied metadata, not the destination passed to `PoolManager.take`. | Needs a product decision on output ownership/destination (multi-asset per-node ledger vs. a separate withdrawal path) before it's a code fix — not attempted here. |
| High | Open (external dependency) | No production identity/claim implementation exists in this checkout. `RealWorldIdGate` is a test helper with unrestricted `setSigner`, no enrollment consumption, and no independent `authTime` freshness check. | Integrate Person B's real `WorldIdGate`/`ClaimRouter`/`ViolationOracle`; test identity continuity, freshness, cancellation, replay and single-payment claims. Never deploy the helper. |
| High | Open (deploy-script hardening) | `Deploy.s.sol` warns and continues when `WORLD_ID_GATE` is zero, but `PolicyRegistry` rejects zero in its constructor; that gate is immutable. Missing `ClaimRouter` disables payouts. | Validate required dependencies before broadcast, plus registrar permissions and all wiring afterward. |
| High | Open (scope decision) | `MockUSDC` is permissionlessly mintable. Raw-unit 1:1 pool initialization is not a justified USDC/WETH price, especially with different decimals. | Deliberate testnet pricing/liquidity; real-asset, token-behavior and slippage assumptions needed before any real funds. |
| Medium | Open | `_dnsEncode` bounds only child byte length; parent length is cast without validation and local ENS normalization constraints are absent. | Explicit normalized-label policy, constructor validation, malformed/Unicode-name tests. |
| Medium | Open | Child expiry is maximal but the parent registration is rented. `PolicyRecord` has no coverage expiry. | Define parent renewal and coverage lifetime; test parent expiry and resolution failure. |

All five fixes were re-verified against real Sepolia state at the pinned fork block (not re-derived
locally): `forge test --no-match-path 'test/fork/*'` (46 passing) and
`forge test --match-path 'test/fork/*'` (21 passing, including the 1,000-user stress run and the deep
invariant profile — see [DEEP_VERIFICATION.md](DEEP_VERIFICATION.md)).

The local Uniswap dependency examined is v4-core `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`, nested under v4-periphery `9969eec44cfdf07e24b41de47f40276a58401976`. PoolManager.swap and Hooks.beforeSwap establish caller identity; Pool.sol's swap loop stops at the price limit and returns actual deltas. [Official deployment reference](https://developers.uniswap.org/docs/protocols/v4/deployments).

## Validation and next gates

Current result (2026-09-26, after the fix pass above): **46 local tests** (7 suites, including the 32-policy randomized invariant handler) and **21 pinned fork tests** — **67 total, all passing, zero compiler warnings.** The fork tests record publication, missing records, DNS-name selection, setter scope, cross-policy isolation and non-transferability against deployed ENS bytecode, plus the five now-fixed defects re-verified against the same real Sepolia state. Sepolia block 11784342 is pinned; `SEPOLIA_FORK_BLOCK` explicitly overrides it. The default `SEPOLIA_RPC_URL_FORK` (publicnode's free endpoint) intermittently lacks archive state for specific accounts at this pinned block even though it's reachable and current-tip queries work fine on it — verified live by testing several accounts directly with `cast`, not assumed; `https://sepolia.gateway.tenderly.co` had full archive state for every account these tests touch and is now the default.

Also re-run and confirmed at larger scale after the fixes: the 1,000-policyholder stress test (`STRESS_USERS=1000`) and the deep invariant profile (`FOUNDRY_PROFILE=deep`, 256×128 = 32,768 randomized calls, 0 unexpected reverts) — see DEEP_VERIFICATION.md.

Run from contracts/:

```sh
forge test --no-match-path 'test/fork/*'
forge test --match-path 'test/fork/*' -vv
```

The fork uses real ENS/Uniswap infrastructure at a historical block, locally deployed Surety contracts and mintable tokens, generated signatures and cheatcode funding. It does not broadcast transactions, verify real World ID sessions, execute the missing claims lifecycle, or establish live deployment ownership.

Implementation order: close vault enforcement/accounting gaps; reconcile ENS records and name validation; integrate actual identity/claims components; harden deployment checks; rehearse a funded Sepolia deployment and full claim flow. Independent contract review remains necessary before real funds.
