// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {PolicyRecord, Payment} from "../src/interfaces/SuretyTypes.sol";

/// @dev Independent reference ledger for randomized deposits/payments/withdrawals across 32 policies.
/// Swaps and real ENS are tested separately in the fork suite; no PoolManager calls occur here.
contract VaultLedgerHandler is Test {
    AgentVault public vault;
    MockUSDC public token;
    uint256[32] public expected;
    uint256 public deposited;
    uint256 public paid;
    uint256 public withdrawn;
    uint256 public paymentCount;
    uint256 public successfulOperations;

    constructor(AgentVault vault_, MockUSDC token_) {
        vault = vault_;
        token = token_;
        token.approve(address(vault), type(uint256).max);
    }

    function holder(uint256 i) public pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(10_000 + i)); // fits uint160, deterministic test actor id
    }

    function agent(uint256 i) public pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(20_000 + i)); // fits uint160, deterministic test actor id
    }

    function node(uint256 i) public pure returns (bytes32) {
        return bytes32(i + 1);
    }

    function deposit(uint256 actorSeed, uint256 amountSeed) external {
        uint256 i = actorSeed % 32;
        uint256 amount = bound(amountSeed, 1, 1_000_000e6);
        token.mint(address(this), amount);
        vault.deposit(node(i), amount);
        expected[i] += amount;
        deposited += amount;
        ++successfulOperations;
    }

    function pay(uint256 actorSeed, uint256 amountSeed) external {
        uint256 i = actorSeed % 32;
        if (expected[i] == 0) return;
        uint256 amount = bound(amountSeed, 1, expected[i]);
        // forge-lint: disable-next-line(unsafe-typecast)
        address recipient = address(uint160(30_000 + i)); // fits uint160, deterministic test actor id
        vm.prank(agent(i));
        uint256 paymentId = vault.pay(node(i), recipient, amount);
        expected[i] -= amount;
        paid += amount;
        assertEq(paymentId, ++paymentCount);
        Payment memory p = vault.getPayment(paymentId);
        assertEq(p.node, node(i));
        assertEq(p.to, recipient);
        assertEq(p.amount, amount);
        ++successfulOperations;
    }

    function withdraw(uint256 actorSeed, uint256 amountSeed) external {
        uint256 i = actorSeed % 32;
        if (expected[i] == 0) return;
        uint256 amount = bound(amountSeed, 1, expected[i]);
        vm.prank(holder(i));
        vault.withdraw(node(i), amount);
        expected[i] -= amount;
        withdrawn += amount;
        ++successfulOperations;
    }

    function attackOtherPolicy(uint256 actorSeed, uint256 victimSeed) external {
        uint256 i = actorSeed % 32;
        uint256 victim = (i + 1 + victimSeed % 31) % 32;
        vm.prank(agent(i));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotAgent.selector, node(victim), agent(i)));
        vault.pay(node(victim), agent(i), 1);
        vm.prank(holder(i));
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotPolicyholder.selector, node(victim), holder(i)));
        vault.withdraw(node(victim), 1);
        ++successfulOperations;
    }
}

contract DeepVaultInvariantTest is StdInvariant, Test {
    AgentVault vault;
    MockUSDC token;
    VaultLedgerHandler handler;

    function setUp() public {
        token = new MockUSDC();
        MockPolicyRegistry registry = new MockPolicyRegistry();
        vault = new AgentVault(registry, token, IPoolManager(address(1)), address(this));
        handler = new VaultLedgerHandler(vault, token);
        for (uint256 i; i < 32; ++i) {
            PolicyRecord memory p;
            p.policyholder = handler.holder(i);
            p.agent = handler.agent(i);
            p.active = true;
            registry.setPolicy(handler.node(i), p);
            handler.deposit(i, 100_000e6);
        }
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.pay.selector;
        selectors[2] = handler.withdraw.selector;
        selectors[3] = handler.attackOtherPolicy.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_custodyEqualsIndependentLedger() public view {
        uint256 sum;
        for (uint256 i; i < 32; ++i) {
            assertEq(vault.balanceOf(handler.node(i)), handler.expected(i));
            sum += handler.expected(i);
        }
        assertEq(token.balanceOf(address(vault)), sum);
        assertEq(handler.deposited(), sum + handler.paid() + handler.withdrawn());
        assertGe(handler.successfulOperations(), 32);
    }
}
