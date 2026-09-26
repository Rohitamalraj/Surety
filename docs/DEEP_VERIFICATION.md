# Deep chain verification

This report concerns the current chain branch on 2026-09-26. No public transactions have been broadcast. Tests create policies and publish ENS records inside a local fork of Sepolia block 11784342. These changes disappear when the test ends.

## What is real and what is simulated

The fork executes deployed ENS ETHRegistrar, UserRegistry, VerifiableFactory, PermissionedResolver, UniversalResolverV2 and Uniswap v4 PoolManager bytecode. Parent registration uses commit/reveal, with time advanced locally. Surety contracts and two mintable six-decimal tokens are deployed inside the fork; the second token is named weth in the fixture but is not canonical 18-decimal WETH. Both the simulated liquidity provider and reserve backers use valueless MockUSDC.

A separate deployed-WETH test uses Sepolia contract `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`, verifies 18 decimals, wraps locally funded ETH through its deposit function, supplies liquidity, and swaps through the real PoolManager/SuretyHook. At an explicit test price of 2,500 USDC/WETH, 250 MockUSDC returns 99,205,460,778,021,562 wei (about 0.09920546 WETH); the vault retains exactly 750 of its initial 1,000 MockUSDC. This is not a live price assertion.

Enrollment uses generated EIP-712 signatures through a test helper, not a World ID session. Reserve payouts exercise a test-authorized caller directly, not a production ClaimRouter. Passing these checks cannot establish real identity verification, claim eligibility, or anti-self-dealing.

## Verification layers

Completed 256-user run: 25,600,000 MockUSDC deposited; 58,240 swapped; 58,065.276497 mock output tokens received; final reserve 101,134,400 MockUSDC; outstanding coverage 2,534,400 MockUSDC. The randomized ledger run completed 32,768 handler calls with zero unexpected reverts. These are local simulations, not public balances.

| Layer | Checks |
|---|---|
| ENS publication | Commit/reveal parent registration, per-policy resolver deployment, ERC-1155 ownership, cap/coverage/premium text records, and full Universal Resolver discovery |
| ENS permissions | Agent can write streak, cannot change coverage/address or escalate setter permissions; isolated proxies prevent cross-policy writes; even unsafeTransfer cannot bypass non-transferability; compatible contract wallets receive names and rejecting receivers roll back issuance |
| Identity boundary | Wrong signer, wrong wallet, altered subject and expired signatures rejected; rollback leaves reserve/namespace unchanged |
| Reserve boundary | 51 policies fit in 1m backing plus premiums; the 52nd fails atomically; exactly 7,500 additional MockUSDC makes it succeed at precisely 2x reserve |
| Many-user pool path | Distinct holders, agents, payout wallets and counterparties; deposits, transfers, withdrawals, full swaps, exact cap/off-allowlist errors, and simulated partial payouts; aggregate custody/reserve/coverage checked after every user |
| Randomized ledger | Independent reference model for 32 policies, mixing deposit/pay/withdraw and cross-policy attacks; 256 sequences of depth 128, with unexpected reverts treated as failures |
| Adversarial diagnostics | Reproduce unsafe behavior explicitly; a passing diagnostic means the defect exists, not that the feature is safe |

The many-user fixture defaults to 256 policies and allows STRESS_USERS from 1 to 1000. Thirty-two additional backers deposit 100 million MockUSDC on top of the original one-million reserve. Every holder deposits 100,000 MockUSDC; each policy has 10,000 coverage, a 500 cap and a 625 premium. Each user pays 250, withdraws 750, swaps 100..499, and receives a simulated 100 payout. This exercises amounts and isolation, not mainnet capacity, real capital, concurrent public transactions or economical gas limits for batching.

## Defects found, then fixed and re-verified against the same real fork

1. **Hook bypass — fixed.** An agent could select a hookless pool and swap 4,000 MockUSDC to an off-allowlist counterparty despite a 500 cap, while the same request through the real Surety pool failed with the exact wrapped CapBreach error. `AgentVault` now pins one owner-set `canonicalPoolKey` (currencies, fee, tick spacing, and hook) and rejects `swap()` calls with any other `PoolKey` (`UnauthorizedPool`). Re-verified: `test_real_hooklessPoolIsRejectedByVault` — the same hookless-pool attempt now reverts before any funds move.
2. **Partial-fill accounting — fixed.** A 500 MockUSDC request at a price limit one unit from the current sqrt price spent only two base units but removed all 500 from the user's ledger (499,999,998 base units of unexplained custody surplus). `swap()` now debits the actually-settled USDC delta read back from `BalanceDelta` after the swap, never the pre-trade request. Re-verified: `test_real_partialFillCreditsOnlyActualSpend` — custody now exactly equals the ledger after the same near-empty partial fill (2 base units spent, not 500,000,000).
3. **ENS status divergence on exhaustion — fixed (status half).** Exhausting a policy changed its struct to inactive while ENS still reported "active". `recordPayout` now writes `surety.status = "exhausted"` to the policy's own real resolver when `paidOut >= coverageLimit`. Re-verified: `test_real_exhaustedPolicyPublishesStatusAndStillSpendsOwnBalance` reads back "exhausted" from the live resolver. Whether an exhausted policy's agent should still be able to spend its own already-deposited vault balance was a separate, deliberate product question — decided as yes (coverageLimit bounds future claim payouts, not vault custody, so this is not a defect) and the test now asserts that behavior explicitly rather than flagging it.
4. **Streak divergence — left as-is, by design.** `updateStreak` changes the struct without touching ENS; a direct, EAC-authorized resolver write changes ENS without touching the struct. This is not a bug to fix: the entire point of granting the agent's key `surety.streak`-only EAC permission is that it can write that field *without* going through `PolicyRegistry`. `test_diagnostic_streakMirrorsDiverge` keeps its name and keeps documenting this as expected, deliberate behavior.
5. **Trusted-router overpayment — fixed.** With two 10,000 policies, the configured router could record a 15,000 payout against one, corrupting shared `totalCoverage` (dropping to 5,000 while the untouched second policy still had 10,000 outstanding). `recordPayout` now bounds the credited amount at `coverageLimit - paidOut` before applying it. Re-verified: `test_real_recordPayoutBoundsToOwnRemainingCoverage` — `paidOut` caps at `coverageLimit`, the second policy's coverage is untouched.
6. **Enrollment replay in the fixture — left as-is, correctly scoped.** One valid signature can buy two different names against the test `RealWorldIdGate`. This demonstrates the supplied test helper's behavior and `PolicyRegistry`'s reliance on its gate, not a finding about the absent production gate (real World ID enrollment attestations are short-lived and single-purpose by construction on Person B's side). `test_diagnostic_enrollmentCanBeReplayedAcrossPolicies` is unchanged.

Swap output tokens still accumulate without a per-policy output withdrawal/accounting API; the many-user check verifies the total output custody only. The user-supplied counterparty is still not the actual recipient of `PoolManager.take`. These two design gaps are genuinely open — they need a product decision (how should multi-asset vault output be owned/withdrawn?), not just a code change, so they were not attempted here. See `docs/INTEGRATION_REVIEW.md`'s status table for the complete, current list of open items.

One failed initial stress fixture used sequential small private-key integers. At the pinned block, the first holder already had an EIP-7702 delegation and rejected ENS ERC-1155 receipt. The fixture now derives distinct named accounts and asserts that holders have no code. Supporting arbitrary smart/delegated wallets still requires ERC-1155 receiver compatibility testing; clearing real account code would have concealed the problem.

## Reproduction

From contracts/, in PowerShell:

```powershell
$env:FOUNDRY_PROFILE = 'deep'
forge test --no-match-path 'test/fork/*' -vv
forge test --match-path 'test/fork/*' -vv
```

To run only defect reproductions or customize the load:

```powershell
forge test --match-test 'test_diagnostic_' -vv
$env:STRESS_USERS = '256'
forge test --match-test test_stress_manyUsersConserveFundsAndReserve -vv
# Larger local simulations need a higher test gas limit; they are not single publishable transactions.
$env:STRESS_USERS = '1000'
forge test --match-test test_stress_manyUsersConserveFundsAndReserve --gas-limit 30000000000 -vv
```

An archive-capable Sepolia RPC is needed; SEPOLIA_RPC_URL_FORK overrides the public default. Fork transactions are local, so no deployment key or public faucet is needed. Never broadcast the fixture's generated keys, test verifier or simulated payouts.

The first 1,000-user attempt stopped after about 338 seconds because PublicNode returned `historical state ... is not available` for a fresh account. Standalone balance/code calls reproduced that RPC failure. The public Tenderly Sepolia endpoint returned the state at the same block and was selected for the retry from the [Ethereum network endpoint list](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-11155111.json). An RPC failure is not a passed load test or evidence of a contract assertion failure.

The default invariant profile uses 64 sequences of 64 calls for routine runs; the deep profile uses 256 sequences of 128. Both fail on unexpected handler reverts. Handler calls that find an empty balance return without spending, so call counts are randomized attempts rather than a claim that every attempted payment moved funds.

## Public publication requirements

Checked configuration presence without printing any secrets: DEPLOYER_PK, WORLD_ID_GATE, CLAIM_ROUTER, ENS_PARENT_REGISTRY and ENROLL_SIG are absent; neither root nor contracts has a local .env file. The deployment manifest is empty. No funded deployer/local signer has been identified.

Before publication, fix the reproduced blockers, provide the actual identity/claims components and their verified wiring, provision a funded Sepolia signer locally, register/control the parent name, seed deliberate liquidity/reserve amounts, and obtain a real enrollment attestation. Publish a manifest with chain ID, contract addresses, transaction hashes and ENS name only after successful receipts. A fork-only policy address must never be presented as a public deployment.
