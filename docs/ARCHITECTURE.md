# Surety — Architecture Notes (Chain layer: ENS + Uniswap)

> Owner: Person A. Written against `docs/PRD.md` §10 (ENS) and §12 (Uniswap v4), after verifying every
> address and API claim below directly against ENS Labs' and Uniswap's own sources (not just recalled
> from training data) on 2026-09-26. Update this file if the beta deployments change — these are testnet
> betas and can move.

## #ens — ENSv2 on Sepolia

### Deployed contracts we integrate with (Sepolia, verified against `docs.ens.domains/learn/deployments`)
| Contract | Address | Role in Surety |
|---|---|---|
| RootRegistry | `0x9703dbd26dab89504490994138cf2c575251a9ce` | Root of the ENSv2 name tree |
| ETHRegistry (a `PermissionedRegistry` rooted at `.eth`) | `0x657ea849311d3d5823348dded7c2aaafb3ede09e` | We register `surety.eth` here (or use the fallback subname if `.eth` registration is contended); source: `contracts/src/registry/PermissionedRegistry.sol` |
| ETHRegistrar | `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca` | Rent/registration controller for new `.eth` names |
| VerifiableFactory | `0x9e726eb570beb6bceb495ab8cda7df517d4e841c` | Deploys per-policy `PermissionedResolver` proxies (see gotcha below) |
| PermissionedResolverImpl | `0x14f09fd05d4585759e54844dc9b00147131cf243` | The implementation every resolver proxy points to |
| UniversalResolverV2 | `0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3` | What `ethers`/`viem`/the ENS app use to resolve records — not called directly by our contracts |

Source repo for all of the above: `github.com/ensdomains/contracts-v2`, commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e` (the exact commit ENS has deployed to Sepolia as of this writing). We vendor **minimal local interfaces** for the functions we actually call (see `contracts/src/interfaces/ens/`) rather than pulling in the whole `contracts-v2` dependency tree (`@ens/contracts`, `@ensdomains/verifiable-factory`, OZ-upgradeable, pinned `solc 0.8.25`) — that tree is built for implementing ENSv2 itself, not for a consumer calling the deployed contracts, and pulling it in whole risks solc/remapping conflicts with our own 0.8.26 + non-upgradeable OZ v5.1.0 setup.

### How subname issuance actually works (confirmed from source, not just the architecture blog post)
`docs.ens.domains/ensv2/overview` and the "Deeper Dive" blog post describe Permissioned Registry / Permissioned Resolver / Enhanced Access Control only at the concept level — no function signatures. The real mechanics, read directly from `PermissionedRegistry.sol`, `PermissionedResolver.sol`, `PermissionedResolverLib.sol`, `EnhancedAccessControl.sol`, `IEnhancedAccessControl.sol`, `RegistryRolesLib.sol`:

**Registering `agentN.surety.eth`:**
```solidity
function register(
    string memory label,        // "agentN"
    address owner,              // policyholder or AgentVault, per design choice below
    IRegistry registry,         // subregistry for this name (0x0 if no further subnames needed under it)
    address resolver,           // the per-policy PermissionedResolver proxy (see below)
    uint256 roleBitmap,         // roles granted to `owner` over this one name — see non-transferability below
    uint64 expiry
) external returns (uint256 tokenId);
```
called on our `surety.eth` registry (itself a `PermissionedRegistry` we own, created the same way under ETHRegistry/ETHRegistrar).

**Non-transferability (PRD §10.2) — confirmed mechanism:** `PermissionedRegistry` is an ERC-1155. Its `_update` transfer hook reverts `TransferDisallowed(tokenId, from)` unless `from` holds `RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN` for that token's resource. **There is no separate "lock" call** — we simply never include `ROLE_CAN_TRANSFER_ADMIN` in the `roleBitmap` passed to `register()`. That alone makes the subname permanently non-transferable. Cheap and exactly matches the PRD requirement.

**Enhanced Access Control — how "agent may write only `surety.streak`" is actually enforced (PRD §10.4):** this is the part the PRD states as a requirement without giving the mechanism, and it turned out to be non-obvious enough to be worth documenting carefully:
- Every EAC role is scoped to a `(resource, account)` pair, and a `PermissionedResolver`'s `setText(name, key, value)` is gated by `onlyRoles(resource(key), ROLE_SET_TEXT)` where `resource(key) = uint256(keccak256(bytes(key)))`. **The resource is derived from the text key string itself** — so granting `ROLE_SET_TEXT` scoped to `resource("surety.streak")` authorizes writing *only* that key; `surety.coverageLimit`, `surety.perTxCap`, etc. hash to different resources the agent has no role in.
- You cannot call the resolver's generic `grantRoles` for this — `PermissionedResolver.grantRoles` is hard-disabled (`revert EACCannotGrantRoles(...)`, comment: "Use `grantSetterRoles()` instead"). The real call is:
  ```solidity
  resolver.grantSetterRoles(
      abi.encodeCall(ITextSetter.setText, (dnsEncodedName, "surety.streak", "")),
      agentKey
  );
  ```
  which the resolver decodes via `decodeSetter()` into `(resource, roleBitmap) = (keccak256("surety.streak"), ROLE_SET_TEXT)` and grants exactly that pair.
- **Resolver setters take DNS-encoded `name` bytes, not `bytes32 node`.** `NameCoder.namehash(name, 0)` is computed internally by the resolver. Anything writing records (our `PolicyRegistry`) needs the DNS-wire-format name, not just the namehash we use everywhere else as the policy key.

### The one real gotcha: resolver instances must be per-policy, not shared
`resource(key)` is **the same value regardless of which name's record is being written on that resolver instance** — the EAC check never looks at node/name, only `(resource, account)`. If `PolicyRegistry` pointed every `agentN.surety.eth` at **one shared** `PermissionedResolver`, granting `agent1` the `surety.streak` setter role would let `agent1` also overwrite `agent2`'s streak on that same shared resolver, because both names' `surety.streak` hashes to the identical resource on that instance. This is exactly why ENS's own docs say "every account gets its own Permissioned Resolver proxy" — it's not cosmetic, it's the isolation boundary.

**Design decision:** `PolicyRegistry.issuePolicy` deploys a **fresh `PermissionedResolver` proxy per policy** via `VerifiableFactory.deployProxy(implementation, salt, initData)` (cheap — it's a minimal proxy pattern), sets it as `agentN.surety.eth`'s resolver, writes the initial `surety.*` records via `multicall`, then calls `grantSetterRoles` scoped to *that* proxy for the agent's streak-only permission. The resolver proxy address is stored in `PolicyRecord` alongside the node so reads can resolve fresh (invariant #4) without re-deriving it. One extra `CREATE2`-style deployment per policy, worth it for correctness — flagged to Person B/C since it changes per-policy gas cost.

### Fallback (per TEAM_PLAN §3, decide at S2 17:00 if EAC/non-transferable issuance is unstable on the beta)
Issue a normal (transferable, unrestricted) subname; keep `PolicyRegistry`'s local `PolicyRecord` mapping as the actual enforcement source (already the plan per PRD §10.5 — ENS records are the *published* source of truth, but enforcement reads the mirrored struct for gas/reliability regardless). State this fallback honestly in the README if taken.

---

## #uniswap — Uniswap v4 on Sepolia

### Deployed contracts (verified against `docs.uniswap.org/contracts/v4/deployments`, section "Sepolia: 11155111")
| Contract | Address |
|---|---|
| **PoolManager** | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| V4Quoter | `0x61b3f2011a92d183c7dbadbda940a7555ccf9227` |
| PoolSwapTest (test router — simplest way for `AgentVault.swap` to reach the pool without building a full router integration) | `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee` |
| PoolModifyLiquidityTest | `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

**Correction worth flagging:** an initial web search summary reported the Sepolia PoolManager as `0x000000000004444c5dc75cB358380D2e3dE08A90` — that is actually the **mainnet** PoolManager address; a generic search snippet conflated chains. Always re-derive from the raw per-chain section of the official deployments page, not a search-engine summary.

### Dependencies added (`contracts/lib/`, git submodules)
- `v4-periphery` (commit `9969eec4`, latest `main` — no tagged releases exist yet) — provides `BaseHook` (hook base contract) and `HookMiner` (CREATE2 salt-mining utility for hook address permission-flag encoding).
- `v4-periphery`'s own nested `lib/v4-core` (**not** a second top-level copy — see below) and `lib/permit2`.

We deliberately do **not** vendor a second, separate copy of `v4-core` at the top level. `v4-periphery` pins its own compatible `v4-core` as a nested submodule, and its `BaseHook` is typed against that copy's `IPoolManager`/`IHooks`. If our `SuretyHook.sol` imported a *different* top-level `v4-core` copy, Solidity would treat identically-named types (`IPoolManager`, `PoolKey`, etc.) from the two copies as distinct, incompatible types at compile time even though the source is nearly identical — a classic diamond-dependency footgun. Fix: our top-level `remappings.txt` points `v4-core/` at `lib/v4-periphery/lib/v4-core/`, so there is exactly one `v4-core` on disk and every import (ours and `v4-periphery`'s) resolves to the same physical files.

### Hook deployment mechanics (confirmed against `docs.uniswap.org/contracts/v4/guides/hooks/hook-deployment`)
- A hook's address encodes which lifecycle callbacks it implements in its low bits (e.g. the `beforeSwap` flag). `HookMiner` brute-forces a `CREATE2` salt so the deployed address has the right low bits for our permission set (`beforeSwap` only, per PRD §12.2).
- `SuretyHook` inherits `BaseHook` from `v4-periphery`, deployed via `script/Deploy.s.sol` using `HookMiner.find(...)` then `CREATE2` with that salt — the standard pattern from Uniswap's own `v4-template`.
- `enforce` is a plain owner-settable `bool` fallback (PRD §12.3/§15.5) independent of the mining step — if the mined-address deployment breaks under time pressure, we can fall back to a plain (non-CREATE2-mined) reserve contract with `enforce=false` and push enforcement into `AgentVault.swap`'s pre-check instead (TEAM_PLAN §3 fallback).

---

## Status
- [x] ENSv2 registry/resolver/EAC mechanics verified against source, not just docs prose (A1, this doc)
- [x] Uniswap v4 Sepolia addresses verified against source, dependencies vendored (part of A1/A5 groundwork)
- [ ] `surety.eth` (or fallback name) actually registered on Sepolia — requires a funded deployer wallet; do this alongside `script/Deploy.s.sol`
- [ ] `MockUSDC.sol`, `PolicyRegistry.sol`, `AgentVault.sol`, `SuretyHook.sol` implementations — tracked per-module in `docs/PROGRESS_A.md`
