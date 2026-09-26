# Integration tests (activate at merge)

`FullStack.t.sol` needs Person A's contracts (`PolicyRegistry`, `AgentVault`, `SuretyHook`, `MockUSDC`,
their ENS mocks) and the v4 dependencies from `a/chain`, so it lives outside `test/` on `b/trust`.

After merging `a/chain` + `b/trust`, move it into `test/` and run it:

```bash
git mv contracts/integration/FullStack.t.sol contracts/test/FullStack.t.sol
cd contracts && forge test --match-path test/FullStack.t.sol -vv
```

It runs `script/DeployTrust.s.sol`'s stages in the real Sepolia order around Person A's deploy, checks
all the wiring and the deployments file, then plays the PRD §23 demo end to end on a real v4
PoolManager: attack swap blocked → violation recorded → claim held on cancel → paid from the reserve.
Verified passing (3/3, alongside A's 45) against `origin/a/chain` @ 606cf0b on 2026-09-26.
