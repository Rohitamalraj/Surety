// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {PolicyRecord, Payment} from "../src/interfaces/SuretyTypes.sol";

/// @dev Unit-level tests against a plain, hookless pool — proving AgentVault's own bookkeeping and its
/// direct PoolManager.unlock/swap mechanics work. The full AgentVault + SuretyHook enforcement story is
/// covered end-to-end in AttackReplay.t.sol.
contract AgentVaultTest is Deployers {
    MockUSDC usdc;
    MockUSDC weth;
    MockPolicyRegistry registryMock;
    AgentVault vault;
    PoolKey poolKey;

    bytes32 constant NODE = bytes32(uint256(1));
    address policyholder = address(0xA11CE);
    address agent = address(0xA6E17);
    address counterparty = address(0xC0FFEE);

    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        usdc.mint(address(this), 1_000_000_000_000e6);
        weth.mint(address(this), 1_000_000_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        weth.approve(address(modifyLiquidityRouter), type(uint256).max);

        registryMock = new MockPolicyRegistry();
        vault = new AgentVault(IPolicyRegistry(address(registryMock)), usdc, manager);

        PolicyRecord memory rec;
        rec.policyholder = policyholder;
        rec.agent = agent;
        rec.payoutAddr = address(0xDEAD);
        rec.coverageLimit = 10_000e6;
        rec.perTxCap = 5_000e6;
        rec.active = true;
        registryMock.setPolicy(NODE, rec);
        registryMock.setAllowed(NODE, counterparty, true);

        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        (poolKey,) = initPoolAndAddLiquidity(c0, c1, IHooks(address(0)), 3000, SQRT_PRICE_1_1);
    }

    ////////////////////////////////////////////////////////////////////////
    // deposit / withdraw / balanceOf
    ////////////////////////////////////////////////////////////////////////

    function test_deposit_increasesBalance() public {
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(NODE, 1_000e6);
        assertEq(vault.balanceOf(NODE), 1_000e6);
        assertEq(usdc.balanceOf(address(vault)), 1_000e6);
    }

    function test_withdraw_onlyPolicyholder() public {
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(NODE, 1_000e6);

        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotPolicyholder.selector, NODE, address(0xBEEF)));
        vault.withdraw(NODE, 500e6);

        vm.prank(policyholder);
        vault.withdraw(NODE, 400e6);
        assertEq(vault.balanceOf(NODE), 600e6);
        assertEq(usdc.balanceOf(policyholder), 400e6);
    }

    function test_withdraw_revertsOnInsufficientBalance() public {
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.InsufficientBalance.selector, NODE, 1e6, 0));
        vault.withdraw(NODE, 1e6);
    }

    ////////////////////////////////////////////////////////////////////////
    // pay — records every transfer, never blocks on a rule breach
    ////////////////////////////////////////////////////////////////////////

    function test_pay_onlyAgent_recordsPaymentRegardlessOfCap() public {
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(NODE, 10_000e6);

        vm.prank(agent);
        // Deliberately over perTxCap (5,000) — pay() must NOT block; that recorded breach is the
        // insured event (PRD §4.2), enforcement/claims happen elsewhere.
        uint256 paymentId = vault.pay(NODE, address(0xFEED), 9_000e6);

        assertEq(paymentId, 1);
        Payment memory p = vault.getPayment(paymentId);
        assertEq(p.node, NODE);
        assertEq(p.to, address(0xFEED));
        assertEq(p.amount, 9_000e6);
        assertEq(vault.balanceOf(NODE), 1_000e6);
        assertEq(usdc.balanceOf(address(0xFEED)), 9_000e6);
    }

    function test_pay_revertsIfNotAgent() public {
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(NODE, 1_000e6);

        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotAgent.selector, NODE, address(this)));
        vault.pay(NODE, address(0xFEED), 500e6);
    }

    function test_getPayment_revertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(AgentVault.InvalidPaymentId.selector, 1));
        vault.getPayment(1);
    }

    ////////////////////////////////////////////////////////////////////////
    // swap — real PoolManager.unlock/swap, direct (not via PoolSwapTest)
    ////////////////////////////////////////////////////////////////////////

    function test_swap_debitsNodeBalanceAndExecutesRealSwap() public {
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(NODE, 10_000e6);

        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        SwapParams memory params = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: -int256(1_000e6),
            sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        vm.prank(agent);
        vault.swap(NODE, poolKey, params, counterparty);

        assertEq(vault.balanceOf(NODE), 9_000e6);
        assertEq(usdc.balanceOf(address(vault)), 9_000e6); // 10,000 deposited - 1,000 swapped away
        assertGt(weth.balanceOf(address(vault)), 0); // received the other side of the trade
    }

    function test_swap_revertsIfNotAgent() public {
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(NODE, 10_000e6);

        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        SwapParams memory params = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: -int256(1_000e6),
            sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotAgent.selector, NODE, address(this)));
        vault.swap(NODE, poolKey, params, counterparty);
    }

    function test_swap_revertsOnExactOutputOrBuyingUsdc() public {
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(NODE, 10_000e6);
        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);

        // Exact-output instead of exact-input.
        SwapParams memory badParams = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: int256(1_000e6),
            sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
        vm.prank(agent);
        vm.expectRevert(AgentVault.OnlyExactInputUsdcSwapsSupported.selector);
        vault.swap(NODE, poolKey, badParams, counterparty);
    }
}
