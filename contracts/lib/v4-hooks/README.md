# Vendored: `BaseHook` + `HookMiner`

`BaseHook.sol` and `HookMiner.sol`, copied verbatim from
[`Uniswap/v4-hooks-public`](https://github.com/Uniswap/v4-hooks-public) at commit
`e4eabe526f9b516fff78d98ba781251747f0fd6e` (`src/base/BaseHook.sol`, `src/utils/HookMiner.sol`).

**Why vendored instead of a git submodule:** `v4-hooks-public` is Uniswap's monorepo for every hook
example and integration across v2/v3/v4, Uniswap X, and third-party forks (Aerodrome, PancakeSwap,
Fluid, etc.) — its `.gitmodules` alone pulls in ~15 unrelated repositories. `BaseHook` used to live in
`v4-periphery/src/utils/BaseHook.sol` (that's what most tutorials and the current
`docs.uniswap.org` hook-deployment guide still show), but Uniswap removed it from `v4-periphery` in
commit `5da22e60` ("remove hooks and move to hook repo (#510)", 2026-02-06) and moved it here.
Verified directly from `v4-periphery`'s own git history, not assumed from the docs guide, which is
stale on this point. Copying the two files we need is far cheaper than cloning the whole monorepo for
a 36-hour hackathon.

Do not hand-edit these two files — if Uniswap patches them, re-fetch from the same repo and update the
pinned commit above.
