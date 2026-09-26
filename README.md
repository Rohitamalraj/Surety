# Surety

**Surety pays out automatically, same day, when an insured AI agent breaks its own stated policy rules — no adjuster, no lawsuit, no months-long claims process.**

> ENS proves what the rules are. World ID proves who's really asking. Uniswap v4 holds the money and enforces the rules.

Built at ETHGlobal Tokyo 2026 for the ENS, World, and Uniswap Foundation tracks.

## The problem
AI agents now spend money autonomously. On May 4, 2026 an attacker manipulated Grok's Bankr wallet into transferring ~$150–200K — a safety block that had stopped a similar attack didn't survive a code rewrite. Meanwhile, ISO exclusion endorsements (effective Jan 1, 2026) carve generative-AI losses out of standard commercial policies. Businesses running agents have no fast, verifiable backstop.

## The solution
Each insured agent gets a **non-transferable ENSv2 name** whose records *are* its policy (per-tx cap, counterparty allowlist, coverage, tier). The agent spends through an `AgentVault`; swaps go through a **Uniswap v4 hook** that blocks rule-breaking trades. If a transfer slips through and breaks the published rules, anyone can recompute the violation on-chain; the policyholder files a claim, passes a **fresh World ID for Agents check** proving they're the same human who bought the policy, and the hook pays out from its reserve — in minutes.

## Architecture

Multi-user simulations, adversarial findings and reproduction commands: [deep verification](docs/DEEP_VERIFICATION.md).

Current code findings, the ENSIP-10 read correction, and open production blockers are in
[`docs/INTEGRATION_REVIEW.md`](docs/INTEGRATION_REVIEW.md). Passing chain tests does not yet establish a complete identity-to-payout flow.
See [`docs/PRD.md`](docs/PRD.md) (full spec) and [`docs/TEAM_PLAN.md`](docs/TEAM_PLAN.md).

| Folder | What |
|---|---|
| `contracts/` | Foundry: PolicyRegistry, AgentVault, SuretyHook, PricingEngine, ViolationOracle, WorldIdGate, ClaimRouter |
| `backend/` | World ID OIDC validation + EIP-712 signer, event indexer, agent simulator |
| `frontend/` | Next.js app: Create Policy, Policy detail, Attack Replay demo, Feed |
| `docs/` | PRD, team plan, pricing model, contracts reference, feedback, pitch |

## Setup
_Filled in as each part lands._

```bash
git clone --recurse-submodules https://github.com/Rohitamalraj/Surety.git
cd Surety/contracts && forge build && forge test
```

## Sponsor tracks
- **ENS — Best Use of ENSv2:** the policy is an ENS record (Permissioned Registry, Permissioned Resolver, Enhanced Access Control).
- **World — Best Use of World ID for Agents:** enrollment at purchase + fresh re-authentication gating every claim payout, validated server-side, with a denied/cancelled path.
- **Uniswap Foundation — Best Uniswap Stack Contribution:** `SuretyHook` enforces policy in `beforeSwap` and holds/releases the pooled reserve.

## Deployed contracts (Sepolia)
_TBD_

## License
MIT
