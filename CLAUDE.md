# Surety — project memory

## What this is
Parametric, on-chain insurance for AI agents. Full spec: `docs/PRD.md` (source of truth).
Team split + timeline: `docs/TEAM_PLAN.md`. Read the relevant PRD section before touching a module.

## Stack
- `contracts/` Solidity 0.8.26 + Foundry, Ethereum Sepolia (ENSv2 beta is Sepolia-only). EVM: cancun.
- `backend/`   TypeScript (Node 20+), World ID for Agents OIDC validation + EIP-712 signer, viem indexer, agent simulator.
- `frontend/`  Next.js + wagmi + viem + Tailwind + shadcn/ui.
- Shared interfaces: `contracts/src/interfaces/` — locked; change only with team agreement.

## Ownership (don't edit other people's files)
- A (ENS + Uniswap): MockUSDC, PolicyRegistry, AgentVault, SuretyHook, contracts/script/
- B (World ID + claims + backend): PricingEngine, ViolationOracle, WorldIdGate, ClaimRouter, backend/
- C (Frontend): frontend/

## Non-negotiable invariants (do not relax these while coding)
1. Claims pay out ONLY from SuretyHook's liquid reserve — never from an LP position or premiums in flight.
2. issuePolicy() reverts if liquidReserve < 2x totalCoverage after issuing.
3. Anti-self-dealing: payout only to payoutAddr fixed at purchase; payoutAddr != violating counterparty;
   each paymentId claimable once; each World ID approval usable once.
4. Resolve the ENS resolver address fresh at call time. Never hard-code a resolver address.
5. World ID results are validated server-side only (backend/). Contracts trust only BACKEND_SIGNER's
   EIP-712 signatures. The frontend never trusts a client-reported verification result.
6. Never put the raw World ID `sub` on-chain or in logs — only keccak256(sub).

## World ID for Agents (sandbox) facts
- Issuer https://sandbox.auth.world.org ; discovery at /.well-known/openid-configuration.
- Confidential client only (register at /portal). Auth-code + PKCE S256, scope=openid exactly.
- Fresh check: prompt=login (or max_age=0); validate auth_time belongs to this attempt. Never use iat for freshness.
- Pairwise sub sector = redirect hostname (immutable) → the same backend callback host must be used for enroll and claim.
- ID tokens last 5 min; codes single-use, 5 min. No UserInfo endpoint.

## Conventions
- One PR-sized change per commit; no giant commits (judges check history).
- Branches: a/chain, b/trust, c/frontend; merge to main at sync points.
- Every contract has a matching test in contracts/test/ before it's done. `forge test` green on main.
- Amounts in MockUSDC (6 decimals). `node` = ENS namehash of `<label>.surety.eth`.
