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
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {SuretyHook} from "../src/SuretyHook.sol";
import {PremiumYieldVault} from "../src/PremiumYieldVault.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";

import {MockWorldIdGate} from "./mocks/MockWorldIdGate.sol";
import {MockEnsSubRegistry} from "./mocks/MockEnsSubRegistry.sol";
import {MockVerifiableFactory} from "./mocks/MockVerifiableFactory.sol";

/// @dev One combined flow, at scale, proving the two-pot model a colleague described in a diagram:
/// (1) the liquid reserve is cash, earns nothing, and is the only thing that can ever pay a claim;
/// (2) the yield vault holds a share of premiums as real Uniswap liquidity, genuinely earns trading
/// fees, and structurally cannot pay a claim (it has no function that could). Many backers and many
/// policyholders act in the same flow, interleaved with real public trading.
contract YieldSplitFullFlowTest is Deployers {
    using Strings for uint256;

    uint256 constant N_BACKERS = 30;
    uint256 constant N_POLICIES = 30;

    MockUSDC usdc;
    MockUSDC weth;
    SuretyHook hook;
    PolicyRegistry registry;
    PremiumYieldVault yieldVault;
    PoolKey poolKey;

    MockWorldIdGate gate;
    MockEnsSubRegistry ensRegistry;
    MockVerifiableFactory verifiableFactory;

    address payoutAddr = address(0xBEEF);
    address counterpartyOk = address(0xC0FFEE);

    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        usdc.mint(address(this), 1_000_000_000_000e6);
        weth.mint(address(this), 1_000_000_000_000e6);
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
        (poolKey,) = initPool(c0, c1, hook, 3000, SQRT_PRICE_1_1);

        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        (int24 lower, int24 upper) = usdcIsToken0 ? (int24(60), int24(600)) : (int24(-600), int24(-60));
        yieldVault.setPoolPosition(poolKey, lower, upper);
    }

    function _backer(uint256 i) internal pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(0xB0B0000 + i)); // fits uint160, deterministic test actor id
    }

    function _holder(uint256 i) internal pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(0xA11CE000 + i)); // fits uint160, deterministic test actor id
    }

    function _agent(uint256 i) internal pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(0xA6E170000 + i)); // fits uint160, deterministic test actor id
    }

    /// @dev Real public trading that pushes price all the way through the vault's one-sided range and
    /// back — sized (and price-limited) to fully cross the whole range in each direction regardless of
    /// how large the position has grown, so both legs pay the pool's 0.3% swap fee on the ENTIRE
    /// position and the position ends the round trip back in its pure-USDC, out-of-range state. This is
    /// standard, load-bearing Uniswap LP behavior, not something specific to this contract.
    function _tradeThroughVaultRangeAndBack() internal {
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        bool intoRange = !usdcIsToken0; // see setUp: range is above current price when usdcIsToken0
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
    }

    function test_manyBackersManyPolicyholders_reserveIsolatedAndYieldVaultEarnsRealFees() public {
        ////////////////////////////////////////////////////////////////////
        // 1. N_BACKERS distinct backers deposit distinct principal amounts.
        ////////////////////////////////////////////////////////////////////
        uint256 totalPrincipal;
        uint256[] memory principals = new uint256[](N_BACKERS);
        for (uint256 i = 0; i < N_BACKERS; i++) {
            principals[i] = (i + 1) * 10_000e6; // 10k, 20k, ... distinct per backer
            totalPrincipal += principals[i];
            address b = _backer(i);
            usdc.mint(b, principals[i]);
            vm.prank(b);
            usdc.approve(address(hook), type(uint256).max);
            vm.prank(b);
            hook.depositBacking(principals[i]);
        }
        assertEq(hook.liquidReserve(), totalPrincipal);
        assertEq(yieldVault.totalBackerPrincipal(), totalPrincipal);

        ////////////////////////////////////////////////////////////////////
        // 2. N_POLICIES distinct policyholders each issue a policy — premium splits every time,
        //    real trading interleaved so the position earns fees across many deposits, not just once.
        ////////////////////////////////////////////////////////////////////
        uint256 totalReserveFromPremiums;
        uint256 totalYieldPortionDeposited;
        for (uint256 i = 0; i < N_POLICIES; i++) {
            address holder = _holder(i);
            usdc.mint(holder, 1_000_000e6);
            vm.prank(holder);
            usdc.approve(address(registry), type(uint256).max);

            address[] memory allowlist = new address[](1);
            allowlist[0] = counterpartyOk;
            IPolicyRegistry.IssueParams memory p = IPolicyRegistry.IssueParams({
                label: string.concat("agent", i.toString()),
                agent: _agent(i),
                payoutAddr: payoutAddr,
                coverageLimit: 10_000e6,
                perTxCap: 500e6,
                allowlist: allowlist,
                tier: 1
            });
            vm.prank(holder);
            registry.issuePolicy(p, bytes32(i + 1), uint64(block.timestamp + 1 hours), bytes(""));

            totalReserveFromPremiums += 437_500_000; // 625e6 premium * 70%
            totalYieldPortionDeposited += 187_500_000; // 625e6 premium * 30%

            if (i % 3 == 2) _tradeThroughVaultRangeAndBack();
        }

        ////////////////////////////////////////////////////////////////////
        // 3. Reserve isolation, at scale — the ONLY thing SuretyHook.liquidReserve() ever reflects is
        //    backer principal plus the reserve's own 70% share of every premium. Real trading through
        //    the yield vault's separate LP position never touches this number.
        ////////////////////////////////////////////////////////////////////
        assertEq(hook.liquidReserve(), totalPrincipal + totalReserveFromPremiums);
        assertEq(usdc.balanceOf(address(hook)), hook.liquidReserve());

        ////////////////////////////////////////////////////////////////////
        // 4. The yield vault has genuinely earned trading fees — checked directly against the pool's
        //    own fee-growth accounting (StateLibrary.getFeeGrowthInside vs. the position's last-recorded
        //    checkpoint), not inferred from withdrawal amounts. This is oracle-free, direction-
        //    independent, and exactly what "earns trading fees from every swap" means at the protocol
        //    level: it does not depend on price ending up back where it started.
        ////////////////////////////////////////////////////////////////////
        assertGt(yieldVault.totalLiquidity(), 0);
        (uint256 fees0, uint256 fees1) = _uncollectedFees();
        assertTrue(fees0 > 0 || fees1 > 0);

        ////////////////////////////////////////////////////////////////////
        // 5. Every backer can withdraw their proportional share; nothing here ever touches the
        //    reserve, at any point, for any backer.
        ////////////////////////////////////////////////////////////////////
        uint256 reserveBeforeWithdrawals = hook.liquidReserve();
        for (uint256 i = 0; i < N_BACKERS; i++) {
            address b = _backer(i);
            uint256 pending = yieldVault.pendingYield(b);
            assertGt(pending, 0); // every backer earned something proportional to their principal
            vm.prank(b);
            (uint256 amount0, uint256 amount1) = yieldVault.withdrawYield();
            assertTrue(amount0 > 0 || amount1 > 0);
        }
        // Withdrawing the entire yield vault never moved the reserve by a single unit.
        assertEq(hook.liquidReserve(), reserveBeforeWithdrawals);
        assertEq(hook.liquidReserve(), totalPrincipal + totalReserveFromPremiums);
    }

    /// @dev Uncollected trading fees owed to the vault's position right now, read directly from the
    /// pool's own fee-growth state (StateLibrary) rather than inferred from prices or balances.
    function _uncollectedFees() internal view returns (uint256 fees0, uint256 fees1) {
        (uint128 liquidity, uint256 lastInside0, uint256 lastInside1) = StateLibrary.getPositionInfo(
            manager, poolKey.toId(), address(yieldVault), yieldVault.tickLower(), yieldVault.tickUpper(), bytes32(0)
        );
        (uint256 curInside0, uint256 curInside1) =
            StateLibrary.getFeeGrowthInside(manager, poolKey.toId(), yieldVault.tickLower(), yieldVault.tickUpper());
        fees0 = FullMath.mulDiv(curInside0 - lastInside0, liquidity, FixedPoint128.Q128);
        fees1 = FullMath.mulDiv(curInside1 - lastInside1, liquidity, FixedPoint128.Q128);
    }
}
