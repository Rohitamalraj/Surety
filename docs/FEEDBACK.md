# Uniswap v4 Developer Feedback

Written by Person A (chain/ENS+Uniswap) while building `SuretyHook.sol` and `AgentVault.sol` for Surety
(ETHGlobal Tokyo 2026). Submitted alongside the Uniswap Developer Feedback Form — this doc is the
detailed version that form asks projects to link to. All of the below is genuine friction hit while
building, not a generic list; each point cites exactly where it happened.

## 1. `BaseHook` / `HookMiner` moved out of `v4-periphery` without the main docs catching up
The official hook-deployment guide (`docs.uniswap.org/contracts/v4/guides/hooks/hook-deployment`) still
shows:
```solidity
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
```
Neither `HookMiner.sol` nor `BaseHook.sol` exist in `v4-periphery/src/` any more — they were removed in
commit `5da22e60` ("remove hooks and move to hook repo (#510)", 2026-02-06) and relocated to
`Uniswap/v4-hooks-public`, which is a large monorepo of hook examples across v2/v3/v4/UniswapX and
several forks (Aerodrome, PancakeSwap, Fluid), not a lightweight place to `git submodule add` for a
36-hour hackathon. We found this by reading `v4-periphery`'s own git history after `find` came up empty
for both files in a fresh clone — not from any docs page. Suggestion: either restore the old path as a
thin re-export, or update the guide's code sample (and its GitHub source link, which still points at the
dead `v4-periphery` path) to reference `v4-hooks-public` directly.

## 2. `beforeSwap`'s `sender` argument is easy to misuse if you don't trace it to its source
We wanted `SuretyHook.beforeSwap` to authorize swaps only from our own `AgentVault` contract by checking
`sender`. The natural-seeming approach — have `AgentVault` call a router (e.g. `PoolSwapTest`) — silently
breaks this: `sender` turns out to be *whoever calls `PoolManager.swap()` directly*, i.e. the router's
own address, not the router's caller. This is only clear from reading `Hooks.beforeSwap`'s own source
(`msg.sender` captured at the point `PoolManager.swap()` is called: `v4-core/src/libraries/Hooks.sol`,
the `beforeSwap` internal helper). Nothing in the concept docs (`/docs/protocols/v4/concepts/hooks`)
states this precisely enough to avoid the mistake. Our fix: `AgentVault` implements `IUnlockCallback`
and calls `PoolManager.unlock`/`swap` itself, so `sender` really is `AgentVault`'s own address.
Suggestion: a short, explicit callout on the hooks concept page — "`sender` is the direct caller of
`PoolManager.swap`/`modifyLiquidity`/etc., never a router's caller" — would have saved real debugging
time, since the bug wouldn't have thrown at all, it would have just silently never matched.

## 3. Decoding a hook's own revert reason in tests requires knowing about ERC-7751 wrapping
Any hook that reverts a custom error (e.g. our `PolicyViolation(bytes32, ViolationType)`) doesn't
propagate that error directly to the caller — `Hooks.callHook` wraps it in `CustomRevert.WrappedError
(address target, bytes4 selector, bytes reason, bytes details)` (ERC-7751 style). `vm.expectRevert` with
the plain inner selector silently fails to match ("call didn't revert" isn't the error you get — you get
a mismatch that looks like your assertion is wrong, not that the data is wrapped). We ended up writing a
small decode helper (`_dropSelector` + `abi.decode(..., (address, bytes4, bytes, bytes))`) to reach the
real reason. This is a completely reasonable design for gas/debuggability on-chain, but it's a genuine
"first hook you write" speed bump for testing. Suggestion: a documented Foundry helper (even just a
snippet in the hooks testing guide) for "asserting your hook's own revert reason through
`WrappedError`" would remove a very avoidable half hour of tracing assembly in `CustomRevert.sol`.

## What worked well
- `v4-core/test/utils/Deployers.sol` + `HookMiner.find` made local, from-scratch hook testing (mining a
  CREATE2 salt for the right permission flags, deploying against a real `PoolManager`) straightforward
  *once assembled* — the actual mechanics are well-designed, it's discovery that cost time, not the API
  itself once found.
- The Sepolia testnet deployment page (`docs.uniswap.org/contracts/v4/deployments`) has exactly the
  addresses needed (`PoolManager`, `PoolSwapTest`, `Permit2`, etc.) in one clearly-labeled per-chain
  table — good reference once you're on the right page (redirect from `docs.uniswap.org` to
  `developers.uniswap.org` works transparently).

## Where this shows up in Surety
`contracts/src/SuretyHook.sol` (the hook itself), `contracts/src/AgentVault.sol` (the direct
`PoolManager` integration point 2 above led to), `contracts/test/SuretyHook.t.sol` and
`contracts/test/AttackReplay.t.sol` (points 2 and 3 both surface in the test assertions there).
