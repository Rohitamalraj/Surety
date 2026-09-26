# Person A (ENS + Uniswap) — Progress Log

One entry per work session, newest first. Companion to `docs/ARCHITECTURE.md` (technical findings)
and `docs/TEAM_PLAN.md` §3 (the task list this log tracks against).

---

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
