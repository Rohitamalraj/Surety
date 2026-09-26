// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {CurrencySettler} from "v4-core/test/utils/CurrencySettler.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {HookMiner} from "v4-hooks/src/utils/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SuretyHook} from "../src/SuretyHook.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {ISuretyHook} from "../src/interfaces/ISuretyHook.sol";
import {PolicyRecord, ViolationType} from "../src/interfaces/SuretyTypes.sol";

/// @dev The test contract itself plays the role of `AgentVault` for the "direct" swaps: it implements
/// `IUnlockCallback` and calls `PoolManager.unlock`/`swap` itself, exactly as the real `AgentVault` will
/// (see docs/ARCHITECTURE.md#uniswap for why routing through the shared `PoolSwapTest` router instead
/// would make `beforeSwap`'s `sender` check unenforceable). Swaps meant to look like ordinary, non-agent
/// public trading go through `swapRouter` (`Deployers`' own `PoolSwapTest` instance) instead.
contract SuretyHookTest is Deployers, IUnlockCallback {
    using CurrencySettler for Currency;

    MockUSDC usdc;
    MockUSDC weth; // stand-in second currency; hook logic only cares about the USDC side
    MockPolicyRegistry registryMock;
    SuretyHook hook;
    PoolKey poolKey;

    bytes32 constant NODE = bytes32(uint256(1));
    address constant COUNTERPARTY_OK = address(0xC0FFEE);
    address constant COUNTERPARTY_BAD = address(0xBAD1BAD1);
    address agentVault;
    address claimRouter = address(0xC1A1);

    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        // Deployers' default LIQUIDITY_PARAMS (liquidityDelta 1e18 across ticks -120..120) needs far
        // more raw token units than a realistic 6-decimal USDC supply would ever have — mint generously
        // purely so `initPoolAndAddLiquidity` has enough to seed the pool.
        usdc.mint(address(this), 1_000_000_000_000e6);
        weth.mint(address(this), 1_000_000_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        weth.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        weth.approve(address(swapRouter), type(uint256).max);

        registryMock = new MockPolicyRegistry();

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs =
            abi.encode(manager, IPolicyRegistry(address(registryMock)), IERC20(address(usdc)), address(this));
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(SuretyHook).creationCode, constructorArgs);

        hook = new SuretyHook{salt: salt}(
            manager, IPolicyRegistry(address(registryMock)), IERC20(address(usdc)), address(this)
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        agentVault = address(this);
        hook.setAgentVault(agentVault);
        hook.setClaimRouter(claimRouter);

        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        (poolKey,) = initPoolAndAddLiquidity(c0, c1, hook, 3000, SQRT_PRICE_1_1);
    }

    ////////////////////////////////////////////////////////////////////////
    // getHookPermissions
    ////////////////////////////////////////////////////////////////////////

    function test_onlyBeforeSwapPermissionSet() public view {
        Hooks.Permissions memory perms = hook.getHookPermissions();
        assertTrue(perms.beforeSwap);
        assertFalse(perms.afterSwap);
        assertFalse(perms.beforeAddLiquidity);
        assertFalse(perms.afterAddLiquidity);
        assertFalse(perms.beforeRemoveLiquidity);
        assertFalse(perms.afterRemoveLiquidity);
        assertFalse(perms.beforeInitialize);
        assertFalse(perms.afterInitialize);
        assertFalse(perms.beforeDonate);
        assertFalse(perms.afterDonate);
    }

    ////////////////////////////////////////////////////////////////////////
    // beforeSwap enforcement
    ////////////////////////////////////////////////////////////////////////

    function test_emptyHookData_publicSwapAllowed_evenWithNoPolicy() public {
        // No policy set for NODE at all — an empty-hookData swap must still go through untouched,
        // since the pool stays open to non-agent traders (PRD §12.3).
        BalanceDelta delta = swap(poolKey, _sellingUsdc(), -int256(1_000e6), bytes(""));
        assertTrue(delta.amount0() != 0 || delta.amount1() != 0);
    }

    function test_agentSwap_withinCap_succeeds() public {
        _setPolicy(500e6);
        bytes memory hookData = abi.encode(NODE, COUNTERPARTY_OK);
        BalanceDelta delta = _directSwap(-int256(100e6), hookData);
        assertTrue(delta.amount0() != 0 || delta.amount1() != 0);
    }

    function test_agentSwap_overCap_reverts() public {
        _setPolicy(500e6);
        bytes memory hookData = abi.encode(NODE, COUNTERPARTY_OK);
        bytes memory reason = _catchReason(address(this), abi.encodeCall(this.directSwapExternal, (-int256(600e6), hookData)));
        (bytes32 node, ViolationType vtype) = _decodeHookError(reason, ISuretyHook.PolicyViolation.selector);
        assertEq(node, NODE);
        assertTrue(vtype == ViolationType.CapBreach);
    }

    function test_agentSwap_offAllowlist_reverts() public {
        _setPolicy(500e6);
        bytes memory hookData = abi.encode(NODE, COUNTERPARTY_BAD);
        bytes memory reason = _catchReason(address(this), abi.encodeCall(this.directSwapExternal, (-int256(100e6), hookData)));
        (bytes32 node, ViolationType vtype) = _decodeHookError(reason, ISuretyHook.PolicyViolation.selector);
        assertEq(node, NODE);
        assertTrue(vtype == ViolationType.OffAllowlist);
    }

    function test_nonAgentSender_withHookData_reverts() public {
        _setPolicy(500e6);
        bytes memory hookData = abi.encode(NODE, COUNTERPARTY_OK);
        bool sellingUsdc = _sellingUsdc();
        bytes memory reason = _catchReason(
            address(swapRouter),
            abi.encodeCall(
                PoolSwapTest.swap,
                (
                    poolKey,
                    SwapParams({
                        zeroForOne: sellingUsdc,
                        amountSpecified: -int256(100e6),
                        sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
                    }),
                    PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                    hookData
                )
            )
        );
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes4 sel = bytes4(reason); // selector extraction, not a value truncation
        (,, bytes memory inner,) = abi.decode(_dropSelector(reason), (address, bytes4, bytes, bytes));
        assertEq(sel, CustomRevert.WrappedError.selector);
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(inner), SuretyHook.UnauthorizedSender.selector);
        address gotSender = abi.decode(_dropSelector(inner), (address));
        assertEq(gotSender, address(swapRouter));
    }

    function test_enforceFalse_bypassesChecks() public {
        _setPolicy(500e6);
        hook.setEnforce(false);
        bytes memory hookData = abi.encode(NODE, COUNTERPARTY_BAD);
        // Would revert CapBreach *and* OffAllowlist if enforced — must succeed with enforce off.
        BalanceDelta delta = _directSwap(-int256(50_000e6), hookData);
        assertTrue(delta.amount0() != 0 || delta.amount1() != 0);
    }

    ////////////////////////////////////////////////////////////////////////
    // Reserve custody
    ////////////////////////////////////////////////////////////////////////

    function test_depositPremium_onlyRegistry() public {
        usdc.mint(address(registryMock), 1_000e6);
        vm.prank(address(registryMock));
        usdc.approve(address(hook), 1_000e6);
        vm.prank(address(registryMock));
        hook.depositPremium(NODE, 1_000e6);
        assertEq(hook.liquidReserve(), 1_000e6);

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(SuretyHook.UnauthorizedSender.selector, address(0xBEEF)));
        hook.depositPremium(NODE, 1);
    }

    function test_depositBacking_anyoneCanFundReserve() public {
        address backer = address(0xB0B);
        usdc.mint(backer, 5_000e6);
        vm.prank(backer);
        usdc.approve(address(hook), 5_000e6);
        vm.prank(backer);
        hook.depositBacking(5_000e6);
        assertEq(hook.liquidReserve(), 5_000e6);
    }

    function test_releasePayout_onlyClaimRouter_andCannotExceedReserve() public {
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(hook), 1_000e6);
        hook.depositBacking(1_000e6);

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(SuretyHook.UnauthorizedSender.selector, address(0xBEEF)));
        hook.releasePayout(1, address(0xCAFE), 1e6);

        vm.prank(claimRouter);
        vm.expectRevert(abi.encodeWithSelector(SuretyHook.InsufficientReserve.selector, 1_000e6, 2_000e6));
        hook.releasePayout(1, address(0xCAFE), 2_000e6);

        vm.prank(claimRouter);
        hook.releasePayout(1, address(0xCAFE), 400e6);
        assertEq(usdc.balanceOf(address(0xCAFE)), 400e6);
        assertEq(hook.liquidReserve(), 600e6);
    }

    ////////////////////////////////////////////////////////////////////////
    // Test-only AgentVault stand-in: direct PoolManager.unlock/swap, not via PoolSwapTest
    ////////////////////////////////////////////////////////////////////////

    function directSwapExternal(int256 amountSpecified, bytes memory hookData) external returns (BalanceDelta) {
        return _directSwap(amountSpecified, hookData);
    }

    function _directSwap(int256 amountSpecified, bytes memory hookData) internal returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(amountSpecified, hookData)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (int256 amountSpecified, bytes memory hookData) = abi.decode(rawData, (int256, bytes));

        bool zeroForOne = _sellingUsdc();
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        BalanceDelta delta = manager.swap(poolKey, params, hookData);

        if (delta.amount0() < 0) poolKey.currency0.settle(manager, address(this), uint256(uint128(-delta.amount0())), false);
        if (delta.amount1() < 0) poolKey.currency1.settle(manager, address(this), uint256(uint128(-delta.amount1())), false);
        if (delta.amount0() > 0) poolKey.currency0.take(manager, address(this), uint256(uint128(delta.amount0())), false);
        if (delta.amount1() > 0) poolKey.currency1.take(manager, address(this), uint256(uint128(delta.amount1())), false);

        return abi.encode(delta);
    }

    ////////////////////////////////////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////////////////////////////////////

    function _sellingUsdc() internal view returns (bool) {
        return Currency.unwrap(poolKey.currency0) == address(usdc);
    }

    function _setPolicy(uint256 perTxCap) internal {
        PolicyRecord memory rec;
        rec.policyholder = address(0x1111);
        rec.agent = address(0x2222);
        rec.payoutAddr = address(0x3333);
        rec.coverageLimit = 10_000e6;
        rec.perTxCap = perTxCap;
        rec.tier = 1;
        rec.active = true;
        registryMock.setPolicy(NODE, rec);
        registryMock.setAllowed(NODE, COUNTERPARTY_OK, true);
        registryMock.setAllowed(NODE, COUNTERPARTY_BAD, false);
    }

    /// @dev Calls `target` with `data` and returns the raw revert bytes, failing the test if the call
    /// *doesn't* revert. Used instead of `vm.expectRevert(exactBytes)` because v4's `Hooks.callHook`
    /// wraps every hook-side revert in ERC-7751's `CustomRevert.WrappedError` before it reaches the
    /// caller — hand-reconstructing that wrapper's raw assembly-level byte layout would be fragile.
    /// Decoding what actually comes back with `abi.decode` is robust regardless of that layout.
    function _catchReason(address target, bytes memory data) internal returns (bytes memory reason) {
        (bool ok, bytes memory ret) = target.call(data);
        assertFalse(ok, "expected call to revert");
        return ret;
    }

    /// @dev Decodes a caught `WrappedError` down to a `PolicyViolation(bytes32, ViolationType)` inner
    /// reason and asserts the wrapped error's own selector matches `expectedInnerSelector`.
    function _decodeHookError(bytes memory wrapped, bytes4 expectedInnerSelector)
        internal
        pure
        returns (bytes32, ViolationType)
    {
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(wrapped), CustomRevert.WrappedError.selector);
        (,, bytes memory inner,) = abi.decode(_dropSelector(wrapped), (address, bytes4, bytes, bytes));
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(inner), expectedInnerSelector);
        return abi.decode(_dropSelector(inner), (bytes32, ViolationType));
    }

    function _dropSelector(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[i + 4];
        }
    }
}
