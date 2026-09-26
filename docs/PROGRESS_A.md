# Person A (ENS + Uniswap) — Progress Log

One entry per work session, newest first. Companion to `docs/ARCHITECTURE.md` (technical findings)
and `docs/TEAM_PLAN.md` §3 (the task list this log tracks against).

---

## Session 3 — 2026-09-26: real-Sepolia-fork verification suite; 5 real defects found and fixed

Continuation of Session 2 the same day, prompted by a direct ask to replace every ENS/Uniswap mock
with real infrastructure and to load-test at scale before trusting anything as "done." Full detail in
`docs/DEEP_VERIFICATION.md` and `docs/INTEGRATION_REVIEW.md` — this entry is the short version.

### What was done
1. **`contracts/test/fork/RealSepoliaFork.t.sol`** — a `vm.createSelectFork`-based suite that replaces
   the ENS mocks used in Session 2's unit tests with the real, currently-deployed Sepolia contracts:
   real `ETHRegistrar` commit-reveal registration of `surety.eth` (paid for in ENS's own deployed test
   USDC via `deal()`, a fork-local cheat — never broadcast), a real `VerifiableFactory`-deployed
   `UserRegistry` proxy as its subregistry, real `PermissionedResolver` proxies per policy, and the real
   Sepolia Uniswap v4 `PoolManager`. Only Person B's absent `WorldIdGate` has a stand-in
   (`RealWorldIdGate`, genuine EIP-712/ECDSA verification against a real generated keypair — not a bool
   toggle). 21 tests, including a 256-to-1000-distinct-policyholder stress run
   (`test_stress_manyUsersConserveFundsAndReserve`, `STRESS_USERS` env-configurable) and a handler-based
   invariant test with an independent reference ledger (`DeepVaultInvariant.t.sol`, 32,768 randomized
   calls at the `deep` Foundry profile, 0 unexpected reverts).
2. **Found the fork's default RPC (publicnode's free endpoint) intermittently lacks archive state** for
   specific accounts at the pinned block, even though it's reachable and current-tip queries on it work
   fine — verified live with direct `cast` calls against several candidate RPCs, not assumed. Switched
   the default to Tenderly's public gateway, which had full archive state for every account touched.
3. **5 real defects found by this adversarial testing, all fixed and re-verified against the real
   fork**, not just locally:
   - `AgentVault.swap` accepted *any* `PoolKey` — a hookless (or differently-hooked) pool bypassed
     enforcement entirely. Fixed: an owner-pinned `canonicalPoolKey` (currencies, fee, tick spacing,
     **and hook**), rejecting anything else.
   - `swap()` debited the *requested* input, not what actually settled — over-debited on any
     price-limited partial fill (measured: requested 500 USDC, actually spent 2 base units, but the
     ledger lost the full 500). Fixed: debits the real post-swap `BalanceDelta`.
   - `recordPayout` trusted the caller's `amount` outright — one policy's overpayment could push its
     `paidOut` past its own `coverageLimit`, corrupting the shared `totalCoverage` invariant every other
     policy's 2x reserve depends on. Fixed: bounds credited amount at remaining coverage.
   - ENS `surety.status` never updated to `"exhausted"` when a policy's coverage ran out. Fixed:
     `recordPayout` now writes it to the policy's own real resolver (a new `_resolvers`/`_dnsNames`
     mapping — not the locked `PolicyRecord` struct, which isn't ours to extend).
   - The published `addr` record was the agent's own EOA instead of `AgentVault` (PRD §10.3). Fixed:
     `PolicyRegistry` now takes an `agentVault` reference, wired post-deploy like `hook`/`claimRouter`.
4. **2 findings deliberately left as-is**, because they're correct/expected behavior, not bugs: an
   agent's direct EAC-granted `surety.streak` write and `PolicyRegistry.updateStreak` are two
   independent paths by design (that's the point of granting the agent direct EAC access) — divergence
   between them isn't a defect to fix. One valid enrollment signature buying two policies against the
   test `RealWorldIdGate` demonstrates that helper's behavior, not the absent production gate's.
5. Audited all of `contracts/src/` for hardcoded values, silent fallbacks, or mock logic — none found.
   The only hardcoded constant is `namehash("eth")` (a mathematical fact, not a config value); every
   real dependency address is a constructor parameter. `MockUSDC`'s naming is the PRD's own testnet
   token, not a stubbed mock of something real.

### Result
67/67 tests passing (46 local + 21 fork), zero build warnings, confirmed at 1,000 policyholders/agents
and with 32,768 randomized invariant calls — all after the fixes, not just before.

### Not done yet
- [ ] The two "open, needs a product decision" items from Session 2's review remain: swap output-token
      ownership/withdrawal, and binding the allowlist check to the real `PoolManager.take` recipient
      rather than caller-supplied metadata.
- [ ] `WORLD_APP_ID`/`WORLD_RP_ID` appeared in the root `.env.example` during this session's continuation
      — flagged to the user directly rather than assumed real or fabricated; not consumed by any code.
- [ ] Still genuinely blocked on a funded Sepolia wallet for an actual broadcast deployment (unchanged
      from Session 2).

## Session 1 — 2026-09-26: groundwork, research, dependency wiring, MockUSDC

**Branch:** `a/chain` (created off `main`, which at branch time only had the shared-interfaces scaffold
commit; `origin/b/trust` already has Person B's WorldIdGate/ClaimRouter/ViolationOracle/PricingEngine/
backend work in progress — nothing from that branch touched here).

### What was done
1. **Read the full spec before touching anything**: `docs/PRD.md` (all 32 sections), `docs/TEAM_PLAN.md`,
   the locked interfaces in `contracts/src/interfaces/`, and the existing Foundry scaffold.
2. **Task A1 (ENSv2 groundwork) — done, in depth.** Rather than trusting docs prose or model recall,
   fetched the actual deployed contract addresses and the real Solidity source of
   `ensdomains/contracts-v2` at the exact commit ENS has live on Sepolia. This surfaced one real,
   non-obvious finding not stated anywhere in the PRD: ENSv2's Enhanced Access Control resources are
   scoped to `(resolver instance, argument-hash)`, not `(name, argument-hash)` — so a shared resolver
   across all `agentN.surety.eth` names would let one agent's streak-writer role leak into every other
   agent's streak field. Fix: `PolicyRegistry` must deploy a fresh `PermissionedResolver` proxy per
   policy via ENS's `VerifiableFactory`, not share one resolver namespace-wide. Full writeup with the
   exact function signatures (`register`, `setText`, `grantSetterRoles`, `decodeSetter`) in
   `docs/ARCHITECTURE.md#ens`. This directly resolves PRD Open Question #3.
3. **Uniswap v4 dependency wiring — done, with one correction to the official docs.** Verified the real
   Sepolia `PoolManager` address (`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`) — a generic web search
   had surfaced the *mainnet* address instead. Also discovered that `docs.uniswap.org`'s own
   hook-deployment guide links to `v4-periphery/src/utils/BaseHook.sol`, which no longer exists —
   Uniswap removed `BaseHook`/`HookMiner` from `v4-periphery` in Feb 2026 (commit `5da22e60`, "remove
   hooks and move to hook repo") and relocated them to `Uniswap/v4-hooks-public`. Confirmed by reading
   `v4-periphery`'s own git history, then vendored just those two files (that repo is a multi-hundred-MB
   monorepo of unrelated hook examples across v2/v3/v4/UniswapX/forks — not worth submoduling whole for
   a hackathon). Details and rationale in `docs/ARCHITECTURE.md#uniswap`.
4. **Dependencies added** (`contracts/lib/`): `v4-periphery` (git submodule, commit `9969eec4`, brings
   its own compatible nested `v4-core` + `permit2` — deliberately *not* a second top-level `v4-core`, to
   avoid duplicate-type compile errors against `BaseHook`); `v4-hooks/` (vendored `BaseHook.sol` +
   `HookMiner.sol` from `Uniswap/v4-hooks-public`, with a README recording exact provenance/commit).
   `contracts/remappings.txt` and `contracts/.env.example` updated with real, verified addresses.
   Confirmed working with a throwaway smoke test importing `BaseHook`, `HookMiner`, `v4-core`'s
   `Hooks`/`IPoolManager` through the new remappings (removed after confirming `forge build` passes).
5. **Task A2 (`MockUSDC.sol`) — done.** Mintable ERC20, 6 decimals, permissionless `mint` (testnet
   faucet token). `test/MockUSDC.t.sol`: 4 tests, all passing (`forge test --match-path
   "test/MockUSDC.t.sol"`).

### Verified facts worth remembering (also saved to durable memory, not just this file)
- Sepolia `PoolManager`: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`
- Sepolia ENSv2 ETHRegistry / VerifiableFactory / PermissionedResolverImpl addresses — see
  `docs/ARCHITECTURE.md#ens` table.
- `BaseHook`/`HookMiner` now live in `Uniswap/v4-hooks-public`, not `v4-periphery`.

### Not done yet (next sessions)
- [ ] Register `surety.eth` (or the fallback name) on Sepolia — needs a funded deployer wallet first.
- [ ] `PolicyRegistry.sol` — the big one: `issuePolicy` (WorldIdGate check, PricingEngine.quote,
      `hook.depositPremium`, per-policy resolver proxy deployment, non-transferable subname mint,
      streak-only EAC grant, 2× reserve check), `updateStreak`, `recordPayout`, `getPolicy`,
      `isAllowed`, `totalCoverage`. Depends on Person B's `WorldIdGate`/`PricingEngine` interfaces
      (already locked) but not their implementations merging in yet — can build/test against the
      interfaces alone.
- [ ] `AgentVault.sol` — `deposit`, `pay` (records, never blocks), `swap` (routes through PoolManager
      with `hookData = abi.encode(node)`), `withdraw`, `getPayment`, `balanceOf`.
- [ ] `SuretyHook.sol` — `BaseHook` subclass, `beforeSwap` enforcement, reserve custody
      (`depositPremium`/`depositBacking`/`releasePayout`), `enforce` fallback flag, hook-address mining
      + `CREATE2` deploy in `script/Deploy.s.sol`.
- [ ] `AttackReplay.t.sol` (A7) once `AgentVault` + `SuretyHook` exist.
- [ ] `script/Deploy.s.sol` + `script/SeedDemo.s.sol` (A6).
- [ ] `npm run abi:export` (A8), `docs/FEEDBACK.md` + Uniswap Developer Feedback Form, `docs/CONTRACTS.md`
      (A9) — feedback form should go out the same day the hook ships, per TEAM_PLAN.

### Commits this session
See `git log a/chain` — one commit per numbered item above (dependency wiring, then MockUSDC, then this
log), not one giant commit, per the project's incremental-commit convention.

---

## Session 2 — 2026-09-26: the four core contracts, end-to-end, all real APIs verified before use

Continuation of Session 1 in the same day. Every remaining item on that session's TODO list is now
done except the two that need a funded wallet / live RPC (neither available in this environment).

### What was done
1. **`SuretyHook.sol`** (A5) — `beforeSwap` enforcement (empty `hookData` → public pool stays open;
   present `hookData` decodes `(node, counterparty)`, checks `sender == agentVault`, reverts
   `PolicyViolation` on cap breach / off-allowlist), reserve custody (`depositPremium`/`depositBacking`/
   `releasePayout`, `enforce` fallback flag). Before writing it, traced `PoolManager.swap` →
   `Hooks.beforeSwap` in v4-core source to confirm exactly what `sender` means — see the correction to
   Session 1's own PoolSwapTest assumption below. 10 tests, including a from-scratch decode of v4's
   ERC-7751 `WrappedError` to assert on the real revert reason underneath it (`_decodeHookError` in
   `SuretyHook.t.sol`) rather than hand-reconstructing the wrapper's raw assembly-level byte layout.
2. **Correction to Session 1:** `PoolSwapTest` (the shared Uniswap test router) turns out to be the
   *wrong* thing for `AgentVault.swap` to route through — `Hooks.beforeSwap`'s `sender` is whoever calls
   `PoolManager.swap()` directly, which would be `PoolSwapTest`'s own address, not `AgentVault`'s,
   breaking the "only the registered vault" check entirely. Fixed by having `AgentVault` implement
   `IUnlockCallback` itself. Recorded in memory and `docs/ARCHITECTURE.md#uniswap` so this doesn't get
   re-assumed next session.
3. **`PricingEngine.sol` placeholder** (unblocks `PolicyRegistry`, which is B's file — see Session 1's
   reasoning on why a placeholder here beats leaving `PolicyRegistry` uncompilable until the branches
   merge). PRD §14's exact formula, verified against all three worked fixtures *exactly*
   (625.00 / 133.33 / 890.63 USDC), not approximately.
4. **`PolicyRegistry.sol`** (A3) — the ENS integration centerpiece. `issuePolicy` validates tier bounds
   and the World ID enrollment signature, quotes and pulls the premium, deploys a fresh
   `PermissionedResolver` proxy per policy via `VerifiableFactory` (Session 1's finding — not a shared
   one), writes every `surety.*` record via `multicall`, grants the agent's key the streak-only setter
   role, registers the non-transferable subname (no `ROLE_CAN_TRANSFER_ADMIN`), enforces the 2× reserve
   invariant last. Minimal hand-written interfaces against the real ENSv2 API added at
   `contracts/src/interfaces/ens/` — verified `VerifiableFactory.deployProxy`, the `Grant` struct,
   `ITextSetter`/`IAddressSetter` signatures, and (critically) `namehash("eth")` with `cast namehash eth`
   rather than trusting recall — my own memory of that constant was off by one hex digit. 11 tests.
5. **`AgentVault.sol`** (A4) — per-node deposit/pay/withdraw ledger; `pay()` never blocks on a rule
   breach (PRD §4.2); `swap()` implements `IUnlockCallback` and calls `PoolManager` directly per the
   correction above, always an exact-input sale of MockUSDC (matches what the hook can check a cap
   against pre-trade without a price quote). 9 tests against a real (hookless) `PoolManager`.
6. **`AttackReplay.t.sol`** (A7) — wires all four real contracts (MockUSDC, PolicyRegistry, AgentVault,
   SuretyHook) plus a real `PoolManager` together, issues a real policy, and replays PRD §8.2/§8.3/§23:
   normal payments succeed; a manipulated over-cap swap and an off-allowlist swap both revert before any
   funds move; a rule-breaking transfer is recorded, not blocked, and is publicly recomputable as a
   violation from nothing but the payment + published policy. The claim-lifecycle half (file claim →
   World ID re-auth → paid) is left for Person B to extend this file with, per TEAM_PLAN §4 B7.
7. **`script/Deploy.s.sol` + `script/SeedDemo.s.sol`** (A6) — deploy order exactly matches PRD §15.9;
   take the real verified Sepolia/ENSv2 addresses plus Person B's `WorldIdGate`/`ClaimRouter` as config,
   logging a warning and skipping that wiring (rather than failing) if either is unset, since both are
   owner-only calls safe to run as a follow-up once B's contracts land. **Not run against live
   Sepolia** — no funded deployer wallet or RPC in this environment; compile-checked only.
8. **`docs/CONTRACTS.md`, `docs/FEEDBACK.md`** (A9) — a contracts reference with file:line links
   verified against the actual source (not hand-typed guesses — checked each one with `grep -n` after
   writing the doc, found and fixed several off-by-a-few-lines mistakes), and genuine Uniswap developer
   feedback from three real friction points hit this session (the `BaseHook`/`HookMiner` relocation, the
   easy-to-misuse `beforeSwap` `sender` semantics, decoding `WrappedError` in tests).

### Every test suite, every commit
`forge test`: 45/45 passing across 6 test files after every commit this session (never committed red).
`forge build`: zero warnings (fixed every lint hit along the way — unchecked ERC20 returns via
`SafeERC20`, unsafe-typecast selector extractions via disable-comments with a stated reason, one
state-mutability restriction). 7 commits this session, each independently buildable and testable.

### Not done yet
- [ ] Register `surety.eth` (or the fallback name) on Sepolia, and actually run `Deploy.s.sol` /
      `SeedDemo.s.sol` against it — both need a funded deployer wallet, which this environment doesn't
      have. First thing to do once one exists.
- [ ] `npm run abi:export` (A8) — genuinely blocked, not skipped: `frontend/` and `backend/` don't exist
      yet on `a/chain` (they're on `c/frontend`/`b/trust`), so there's nowhere to export ABIs *to* until
      a sync-point merge. Re-visit right after merging with the other two branches.
- [ ] Etherscan verification — needs the live deployment above.
- [ ] Actually submitting the Uniswap Developer Feedback Form (the doc is ready; the form itself is a
      human action, same-day-as-the-hook-ships per TEAM_PLAN).
- [ ] Reconcile `PricingEngine.sol` with Person B's real (already-committed, on `origin/b/trust`) file
      at the next merge — expect this to be closer to a no-op than a real conflict, since both
      implement the same locked PRD §14 formula.
