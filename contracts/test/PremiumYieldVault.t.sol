// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint128} from "v4-core/src/libraries/FixedPoint128.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HookMiner} from "v4-hooks/src/utils/HookMiner.sol";

import {SuretyHook} from "../src/SuretyHook.sol";
import {PremiumYieldVault} from "../src/PremiumYieldVault.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";

import {MockWorldIdGate} from "./mocks/MockWorldIdGate.sol";
import {MockEnsSubRegistry} from "./mocks/MockEnsSubRegistry.sol";
import {MockVerifiableFactory} from "./mocks/MockVerifiableFactory.sol";
import {MockSuretyHook} from "./mocks/MockSuretyHook.sol";

/// @dev Exercises the premium yield split against a REAL SuretyHook and a REAL local Uniswap v4
/// PoolManager (Deployers), not a mock hook — the point is to prove PremiumYieldVault genuinely calls
/// PoolManager.modifyLiquidity, and that liquidReserve()/the 2x solvency check are provably isolated
/// from it, using the real contracts those checks actually run against.
contract PremiumYieldVaultTest is Deployers {
    MockUSDC usdc;
    MockUSDC weth;
    SuretyHook hook;
    PolicyRegistry registry;
    PremiumYieldVault yieldVault;
    PoolKey poolKey;

    MockWorldIdGate gate;
    MockEnsSubRegistry ensRegistry;
    MockVerifiableFactory verifiableFactory;

    address policyholder = address(0xA11CE);
    address agent = address(0xA6E17);
    address payoutAddr = address(0xBEEF);
    address counterpartyOk = address(0xC0FFEE);
    address backer1 = address(0xB0B1);
    address backer2 = address(0xB0B2);

    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        usdc.mint(address(this), 1_000_000_000_000e6);
        weth.mint(address(this), 1_000_000_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        weth.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        weth.approve(address(swapRouter), type(uint256).max);

        gate = new MockWorldIdGate();
        ensRegistry = new MockEnsSubRegistry();
        verifiableFactory = new MockVerifiableFactory();

        registry =
            new PolicyRegistry(ensRegistry, verifiableFactory, address(0xD00D), gate, usdc, "surety", address(this));

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs =
            abi.encode(manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), address(this));
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(SuretyHook).creationCode, constructorArgs);
        hook = new SuretyHook{salt: salt}(
            manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), address(this)
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        registry.setHook(hook);
        registry.setAgentVault(address(0xFEED0000));
        hook.setAgentVault(address(0xFEED0000));

        yieldVault = new PremiumYieldVault(usdc, manager, address(registry), address(this));
        registry.setPremiumYieldVault(address(yieldVault));
        hook.setPremiumYieldVault(address(yieldVault));
        yieldVault.setSuretyHook(address(hook));

        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        // No fixture liquidity added here (unlike AgentVault.t.sol/SuretyHook.t.sol) — the vault's own
        // one-sided position is deliberately this pool's ONLY liquidity, so a real swap through it
        // (see test_liquidReserveIsolatedFromYieldVault_evenAfterSimulatedImpermanentLoss) has a
        // large, easily observable effect instead of being absorbed by unrelated deep liquidity.
        (poolKey,) = initPool(c0, c1, hook, 3000, SQRT_PRICE_1_1);

        // Current tick is ~0 (SQRT_PRICE_1_1) — pick a range strictly on one side of it so the vault's
        // deposits require only USDC at deposit time (see PremiumYieldVault._addLiquidity).
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        (int24 lower, int24 upper) = usdcIsToken0 ? (int24(60), int24(600)) : (int24(-600), int24(-60));
        yieldVault.setPoolPosition(poolKey, lower, upper);

        usdc.mint(policyholder, 1_000_000e6);
        vm.prank(policyholder);
        usdc.approve(address(registry), type(uint256).max);
    }

    function _params(uint256 coverage, uint256 perTxCap, uint8 tier, uint256 allowlistLen)
        internal
        view
        returns (IPolicyRegistry.IssueParams memory p)
    {
        address[] memory allowlist = new address[](allowlistLen);
        for (uint256 i = 0; i < allowlistLen; i++) {
            allowlist[i] = counterpartyOk;
        }
        p = IPolicyRegistry.IssueParams({
            label: "agent1",
            agent: agent,
            payoutAddr: payoutAddr,
            coverageLimit: coverage,
            perTxCap: perTxCap,
            allowlist: allowlist,
            tier: tier
        });
    }

    function _issue(IPolicyRegistry.IssueParams memory p) internal returns (bytes32 node) {
        vm.prank(policyholder);
        node = registry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function _fundBacker(address backer, uint256 amount) internal {
        usdc.mint(backer, amount);
        vm.prank(backer);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(backer);
        hook.depositBacking(amount);
    }

    ////////////////////////////////////////////////////////////////////////
    // Access control
    ////////////////////////////////////////////////////////////////////////

    function test_depositPremiumShare_onlyPolicyRegistry() public {
        usdc.mint(address(this), 100e6);
        usdc.approve(address(yieldVault), 100e6);
        vm.expectRevert(abi.encodeWithSelector(PremiumYieldVault.NotPolicyRegistry.selector, address(this)));
        yieldVault.depositPremiumShare(100e6);
    }

    function test_creditBackerPrincipal_onlySuretyHook() public {
        vm.expectRevert(abi.encodeWithSelector(PremiumYieldVault.NotSuretyHook.selector, address(this)));
        yieldVault.creditBackerPrincipal(backer1, 100e6);
    }

    function test_setYieldShareBps_cannotExceedMax() public {
        vm.expectRevert(abi.encodeWithSelector(PremiumYieldVault.ExceedsMaxYieldShare.selector, 5001));
        yieldVault.setYieldShareBps(5001);

        yieldVault.setYieldShareBps(5000); // exactly the cap is fine
        assertEq(yieldVault.yieldShareBps(), 5000);
    }

    ////////////////////////////////////////////////////////////////////////
    // The split itself, and real pool interaction
    ////////////////////////////////////////////////////////////////////////

    function test_issuePolicy_splitsPremium70DirectAnd30ToYieldVault_realPoolDeposit() public {
        // 750,000 / 250,000 backer split so the reward math below (and PricingEngine's fixture-1
        // premium of exactly 625 USDC for a fresh 10,000-coverage, tier-1 policy) divides evenly.
        _fundBacker(backer1, 750_000e6);
        _fundBacker(backer2, 250_000e6);
        uint256 reserveBefore = hook.liquidReserve();

        bytes32 node = _issue(_params(10_000e6, 500e6, 1, 1));

        uint256 premium = 625e6;
        uint256 expectedYieldPortion = premium * 3000 / 10_000; // 187.5 USDC
        uint256 expectedReservePortion = premium - expectedYieldPortion; // 437.5 USDC

        assertEq(hook.liquidReserve(), reserveBefore + expectedReservePortion);

        // Nothing sits idle as an un-deployed token balance — the whole yield portion went into the
        // pool as real liquidity (backer principal was already nonzero at deposit time).
        assertEq(usdc.balanceOf(address(yieldVault)), 0);

        // Proves this was a real PoolManager.modifyLiquidity call, not just a token transfer: the vault
        // now owns actual liquidity in the pool, and that liquidity converts back to ~ the USDC amount
        // deposited (small rounding from the liquidity <-> token-amount conversion is expected).
        assertGt(yieldVault.totalLiquidity(), 0);
        assertApproxEqAbs(_positionUsdcSide(), expectedYieldPortion, 2);

        registry.getPolicy(node); // node is a real, issued policy — used for readability above
    }

    function test_proportionalYieldAttribution_matchesBackerPrincipalShare() public {
        _fundBacker(backer1, 750_000e6); // 75% of principal
        _fundBacker(backer2, 250_000e6); // 25% of principal

        _issue(_params(10_000e6, 500e6, 1, 1)); // premium 625 USDC -> yield portion 187.5 USDC

        assertEq(yieldVault.pendingYield(backer1), 140_625_000); // 75% of 187,500,000
        assertEq(yieldVault.pendingYield(backer2), 46_875_000); // 25% of 187,500,000
        assertEq(yieldVault.pendingYield(backer1) + yieldVault.pendingYield(backer2), 187_500_000);
    }

    function test_split_isZeroWhenVaultUnwired() public {
        // A fresh registry + MockSuretyHook, deliberately not sharing the suite's real `hook` (which is
        // immutably bound to `registry` only — SuretyHook.depositPremium trusts exactly one caller).
        // This isolates the one claim under test: PolicyRegistry's own split logic when unwired.
        MockSuretyHook freshHook = new MockSuretyHook(usdc);
        PolicyRegistry freshRegistry =
            new PolicyRegistry(ensRegistry, verifiableFactory, address(0xD00D), gate, usdc, "surety2", address(this));
        freshRegistry.setHook(freshHook);
        freshRegistry.setAgentVault(address(0xFEED0000));
        // premiumYieldVault deliberately left unset — must behave exactly as it did before this feature
        // existed: 100% of the premium to the reserve, nothing skimmed off.
        assertEq(address(freshRegistry.premiumYieldVault()), address(0));

        address backer = address(0xB0B9);
        usdc.mint(backer, 1_000_000e6);
        vm.prank(backer);
        usdc.approve(address(freshHook), type(uint256).max);
        vm.prank(backer);
        freshHook.depositBacking(1_000_000e6);

        vm.prank(policyholder);
        usdc.approve(address(freshRegistry), type(uint256).max);
        vm.prank(policyholder);
        freshRegistry.issuePolicy(
            _params(10_000e6, 500e6, 1, 1), bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes("")
        );

        assertEq(freshHook.liquidReserve(), 1_000_000e6 + 625e6); // full premium, no split
        assertEq(usdc.balanceOf(address(yieldVault)), 0);
        assertEq(yieldVault.totalLiquidity(), 0);
    }

    ////////////////////////////////////////////////////////////////////////
    // Price drift into the configured range must not brick policy issuance
    ////////////////////////////////////////////////////////////////////////

    /// @dev Found by deliberately trying to break this: ordinary public trading that pushes price into
    /// (not even through) the vault's configured one-sided range means a later premium deposit would
    /// need the paired token too, which the vault never holds. Before this test existed, that reverted
    /// PolicyRegistry.issuePolicy's ENTIRE transaction — a real policyholder's purchase failing because
    /// of unrelated pool activity. _addLiquidity now fails soft instead.
    function test_priceDriftIntoVaultRange_doesNotRevertIssuePolicy() public {
        _fundBacker(backer1, 1_000_000e6);
        _issue(_params(10_000e6, 500e6, 1, 1)); // seeds the vault's range with real liquidity

        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        bool intoRange = !usdcIsToken0;
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: intoRange,
                amountSpecified: -int256(100e6),
                sqrtPriceLimitX96: intoRange ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        uint256 liquidityBefore = yieldVault.totalLiquidity();
        uint256 sharesBefore = yieldVault.totalShares();
        uint256 vaultValueBefore = yieldVault.totalYieldVaultValue();

        address[] memory allowlist = new address[](1);
        allowlist[0] = counterpartyOk;
        IPolicyRegistry.IssueParams memory p2 = IPolicyRegistry.IssueParams({
            label: "agent2",
            agent: agent,
            payoutAddr: payoutAddr,
            coverageLimit: 10_000e6,
            perTxCap: 500e6,
            allowlist: allowlist,
            tier: 1
        });
        vm.prank(policyholder);
        // Does not revert — this is the fix. Previously reverted with ERC20InsufficientBalance from
        // deep inside PoolManager.unlock's callback.
        registry.issuePolicy(p2, bytes32(uint256(2)), uint64(block.timestamp + 1 hours), bytes(""));

        // The premium was still charged and still split 70/30 — the reserve is unaffected either way.
        assertEq(hook.liquidReserve(), 1_000_000e6 + 437_500_000 * 2);

        // totalLiquidity didn't grow (the add failed soft), but the yield portion's value is still
        // fully accounted for as real, uncommitted USDC sitting in the vault.
        assertEq(yieldVault.totalLiquidity(), liquidityBefore);
        assertGt(yieldVault.totalShares(), sharesBefore); // shares still minted fairly for the real value
        assertApproxEqAbs(yieldVault.totalYieldVaultValue(), vaultValueBefore + 187_500_000, 2);
    }

    ////////////////////////////////////////////////////////////////////////
    // Isolation from liquidReserve() / the solvency check, even under real IL
    ////////////////////////////////////////////////////////////////////////

    function test_liquidReserveIsolatedFromYieldVault_evenAfterSimulatedImpermanentLoss() public {
        _fundBacker(backer1, 750_000e6);
        _fundBacker(backer2, 250_000e6);
        _issue(_params(10_000e6, 500e6, 1, 1));

        uint256 reserveBeforeSwap = hook.liquidReserve();
        (uint256 usdcSideBefore,) = _positionBothSides();
        assertGt(usdcSideBefore, 0);

        // A real, large public swap through the same pool — moves price hard through the vault's
        // one-sided range, converting part of its position into the paired token (real impermanent
        // loss, not simulated data). This does not touch AgentVault/SuretyHook at all.
        // The vault's one-sided range sits ABOVE current price when USDC is token0 (needs tick to rise:
        // sell token1/buy token0, zeroForOne=false) and BELOW current price when USDC is token1 (needs
        // tick to fall: sell token0/buy token1, zeroForOne=true) — see setUp's own range choice.
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        bool zeroForOne = !usdcIsToken0;
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(50_000e6),
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        (uint256 usdcSideAfter, uint256 pairedSideAfter) = _positionBothSides();
        // The position's composition actually changed (real IL), proving the swap really moved the
        // vault's own liquidity, not just the pool's headline price.
        assertTrue(usdcSideAfter != usdcSideBefore || pairedSideAfter > 0);

        // The only number PolicyRegistry.issuePolicy()'s solvency check and SuretyHook.liquidReserve()
        // ever read is SuretyHook's own USDC balance — completely untouched by any of the above.
        assertEq(hook.liquidReserve(), reserveBeforeSwap);
        assertEq(hook.liquidReserve(), usdc.balanceOf(address(hook)));
    }

    /// @dev Proves the fee-distribution fix directly: with a single backer owning 100% of the vault's
    /// shares, real trading fees accrued on the position must show up in their withdrawal — before the
    /// share-based rewrite, withdrawYield() paid out only the fixed nominal entitlement (187.5 USDC)
    /// and left any fee surplus permanently stranded in the vault, unclaimed by anyone.
    function test_withdrawYield_distributesFeeSurplus_notJustNominalEntitlement() public {
        _fundBacker(backer1, 1_000_000e6); // sole backer -> owns 100% of shares once minted
        _issue(_params(10_000e6, 500e6, 1, 1)); // 625 USDC premium -> 187.5 USDC yield portion

        uint256 nominalEntitlement = 187_500_000;
        assertEq(yieldVault.pendingYield(backer1), nominalEntitlement); // 1:1 at first-ever mint

        // Real trading that fully crosses the vault's thin one-sided range and back, generating real,
        // measurable protocol fees on the position (same mechanism proven in
        // YieldSplitFullFlow.t.sol via StateLibrary.getFeeGrowthInside).
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        bool intoRange = !usdcIsToken0;
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: intoRange,
                amountSpecified: -int256(500_000e6),
                sqrtPriceLimitX96: intoRange ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: !intoRange,
                amountSpecified: -int256(500_000e6),
                sqrtPriceLimitX96: !intoRange ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        (uint256 fees0, uint256 fees1) = _uncollectedFees();
        assertTrue(fees0 > 0 || fees1 > 0); // real fees genuinely accrued from the trading above

        // The decisive proof: this backer owns 100% of the vault's shares, so their withdrawal must
        // empty the ENTIRE position (totalLiquidity -> 0). Under the old, pre-fix code, withdrawYield()
        // computed `liquidityToRemove` by targeting a fixed nominal VALUE (187.5 USDC) rather than a
        // share of totalLiquidity — if fees had grown the position's value beyond that nominal figure,
        // a "full" withdrawal by the sole owner would have left real, nonzero liquidity stranded behind,
        // owned by nobody. The new share-based redemption can't do that: shares == totalShares here, so
        // liquidityToRemove == totalLiquidity by construction, not by hoping the valuation lined up.
        vm.prank(backer1);
        (uint256 amount0, uint256 amount1) = yieldVault.withdrawYield();

        assertEq(yieldVault.totalLiquidity(), 0);
        assertEq(yieldVault.totalShares(), 0);
        assertTrue(amount0 > 0 || amount1 > 0);
    }

    function test_withdrawYield_removesRealLiquidityAndPaysBacker() public {
        _fundBacker(backer1, 1_000_000e6);
        _issue(_params(10_000e6, 500e6, 1, 1));

        uint256 usdcBefore = usdc.balanceOf(backer1);
        vm.prank(backer1);
        (uint256 amount0, uint256 amount1) = yieldVault.withdrawYield();

        assertTrue(amount0 > 0 || amount1 > 0);
        assertEq(usdc.balanceOf(backer1) - usdcBefore, _usdcSideOf(amount0, amount1));
        assertEq(yieldVault.pendingYield(backer1), 0);

        vm.expectRevert(PremiumYieldVault.NothingToWithdraw.selector);
        vm.prank(backer1);
        yieldVault.withdrawYield();
    }

    ////////////////////////////////////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////////////////////////////////////

    function _positionBothSides() internal view returns (uint256 usdcSide, uint256 pairedSide) {
        (uint256 amount0, uint256 amount1) = yieldVault.positionComposition();
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        (usdcSide, pairedSide) = usdcIsToken0 ? (amount0, amount1) : (amount1, amount0);
    }

    function _positionUsdcSide() internal view returns (uint256 usdcSide) {
        (usdcSide,) = _positionBothSides();
    }

    /// @dev Uncollected trading fees owed to the vault's position right now, read directly from the
    /// pool's own fee-growth state rather than inferred from prices or balances — same method as
    /// YieldSplitFullFlow.t.sol.
    function _uncollectedFees() internal view returns (uint256 fees0, uint256 fees1) {
        (uint128 liquidity, uint256 lastInside0, uint256 lastInside1) = StateLibrary.getPositionInfo(
            manager, poolKey.toId(), address(yieldVault), yieldVault.tickLower(), yieldVault.tickUpper(), bytes32(0)
        );
        (uint256 curInside0, uint256 curInside1) =
            StateLibrary.getFeeGrowthInside(manager, poolKey.toId(), yieldVault.tickLower(), yieldVault.tickUpper());
        fees0 = FullMath.mulDiv(curInside0 - lastInside0, liquidity, FixedPoint128.Q128);
        fees1 = FullMath.mulDiv(curInside1 - lastInside1, liquidity, FixedPoint128.Q128);
    }

    function _usdcSideOf(uint256 amount0, uint256 amount1) internal view returns (uint256) {
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        return usdcIsToken0 ? amount0 : amount1;
    }
}
