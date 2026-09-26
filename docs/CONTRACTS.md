# Surety — Contracts Reference (Chain layer)

Owner: Person A. Companion to `docs/ARCHITECTURE.md` (design rationale) and `docs/PRD.md` §15 (spec).
Line numbers are as of this branch's latest commit — re-check after any further edits; Etherscan links
will replace the file:line references below once contracts are verified on Sepolia (submission
checklist item).

## `contracts/src/MockUSDC.sol`
Mintable, permissionless, 6-decimal ERC20 test token. Backs premiums, backer deposits, claim payouts,
and one side of the Uniswap v4 pool.

## `contracts/src/PolicyRegistry.sol`
Issues ENSv2-backed policies.
- [`issuePolicy`](../contracts/src/PolicyRegistry.sol#L111) — validates tier bounds, checks the World ID
  enrollment signature, quotes and pulls the premium, deploys a fresh `PermissionedResolver` proxy per
  policy, writes every `surety.*` record, registers the non-transferable subname, enforces the 2×
  liquid-reserve invariant last.
- [`_setUpEnsRecords`](../contracts/src/PolicyRegistry.sol#L207) — the ENS integration itself: per-policy
  resolver deployment via `VerifiableFactory`, `multicall`'d record writes, and the agent's
  streak-only `grantSetterRoles` call. **This is the ENS track's centerpiece** — see
  `docs/ARCHITECTURE.md#ens` for why a shared resolver instead would have been a real security bug, not
  a style choice.
- [`updateStreak`](../contracts/src/PolicyRegistry.sol#L161) — only the policy's agent key.
- [`recordPayout`](../contracts/src/PolicyRegistry.sol#L169) — only `ClaimRouter`; deactivates an
  exhausted policy.

## `contracts/src/AgentVault.sol`
Every agent's spending wallet, keyed by ENS node.
- [`pay`](../contracts/src/AgentVault.sol#L64) — records every transfer, never blocks on a rule breach
  (PRD §4.2 — the recorded breach *is* the insured event).
- [`swap`](../contracts/src/AgentVault.sol#L89) / [`unlockCallback`](../contracts/src/AgentVault.sol#L109)
  — calls Uniswap v4's `PoolManager` directly (`IUnlockCallback`), not through the shared `PoolSwapTest`
  router, so `SuretyHook.beforeSwap`'s `sender` check means something (docs/ARCHITECTURE.md#uniswap).

## `contracts/src/SuretyHook.sol`
The Uniswap v4 hook and liquid reserve.
- [`_beforeSwap`](../contracts/src/SuretyHook.sol#L140) — **the enforcement centerpiece for the Uniswap
  track.** Empty `hookData` leaves the pool open to public trading; present `hookData` decodes
  `(node, counterparty)`, requires `sender == agentVault`, and reverts `PolicyViolation` on a cap breach
  or off-allowlist counterparty.
- [`depositPremium`](../contracts/src/SuretyHook.sol#L86) / [`depositBacking`](../contracts/src/SuretyHook.sol#L93)
  / [`releasePayout`](../contracts/src/SuretyHook.sol#L99) — reserve custody; `releasePayout` can never
  exceed `liquidReserve()` (CLAUDE.md invariant #1 — there's no LP-split feature here, so
  `liquidReserve() == usdc.balanceOf(this)` always holds).
- [`getHookPermissions`](../contracts/src/SuretyHook.sol#L116) — `beforeSwap` only.

## `contracts/src/PricingEngine.sol`
**Placeholder** — Person B owns this file. Implements PRD §14's exact formula and TEAM_PLAN §2's locked
signature so `PolicyRegistry` compiles and tests today; swap for B's canonical file at the merge sync
point.

## `contracts/src/interfaces/ens/`
Minimal, hand-written interfaces against the real deployed ENSv2 beta contracts (`IEnsSubRegistry`,
`IEnsPermissionedResolver`, `IVerifiableFactory`, `IEnsResolverInitializable`) and the role-bit constants
they rely on (`EnsRoles`) — not the full `ensdomains/contracts-v2` source tree. Every signature is cited
against the exact upstream commit it was verified from; see docs/ARCHITECTURE.md#ens for the full
rationale and the one real gotcha (per-policy resolver instances) it documents.

## `contracts/lib/v4-hooks/`
Vendored `BaseHook.sol` + `HookMiner.sol` from `Uniswap/v4-hooks-public` — `v4-periphery` removed both in
Feb 2026 and relocated them there; the official hook-deployment guide still links the old, now-dead path.
See the folder's own `README.md` for the exact commit and reasoning.

## Tests (`contracts/test/`)
| File | Covers |
|---|---|
| `MockUSDC.t.sol` | Metadata, permissionless mint, standard ERC20 behavior |
| `PricingEngine.t.sol` | All three PRD §14.1 worked fixtures, exactly (not approximately) |
| `SuretyHook.t.sol` | `beforeSwap` enforcement (cap, allowlist, sender, `enforce` flag), reserve custody — including decoding v4's ERC-7751 `WrappedError` to assert on the real reason underneath it |
| `PolicyRegistry.t.sol` | Full `issuePolicy` happy path and every revert path, ENS record writes, streak role scoping, `updateStreak`/`recordPayout` access control |
| `AgentVault.t.sol` | Deposit/pay/withdraw bookkeeping, direct `PoolManager.unlock`/`swap` mechanics against a real (hookless) pool |
| `AttackReplay.t.sol` | The chain-layer half of PRD §8.2/§8.3/§23 end-to-end against all four real contracts together |

`contracts/test/mocks/` — test-only doubles for everything outside Person A's ownership (WorldIdGate,
the ENS registry/resolver/factory, SuretyHook where a lighter double suffices) and for SuretyHook itself
where PolicyRegistry/AgentVault tests don't need the real Uniswap machinery.

## Scripts (`contracts/script/`)
`Deploy.s.sol`, `SeedDemo.s.sol` — see their own header doc-comments for exact behavior and required env
vars (`contracts/.env.example`). **Not yet run against live Sepolia** — no funded deployer wallet in this
build session; written and compile-checked against the locked deploy order (PRD §15.9).
