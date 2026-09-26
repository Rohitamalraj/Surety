// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {PolicyRecord} from "../src/interfaces/SuretyTypes.sol";
import {EnsRoles} from "../src/interfaces/ens/EnsRoles.sol";

import {MockWorldIdGate} from "./mocks/MockWorldIdGate.sol";
import {MockSuretyHook} from "./mocks/MockSuretyHook.sol";
import {MockEnsSubRegistry} from "./mocks/MockEnsSubRegistry.sol";
import {MockVerifiableFactory} from "./mocks/MockVerifiableFactory.sol";
import {MockEnsResolver} from "./mocks/MockEnsResolver.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry registry;
    MockUSDC usdc;
    MockWorldIdGate gate;
    MockSuretyHook hook;
    MockEnsSubRegistry ensRegistry;
    MockVerifiableFactory verifiableFactory;

    address policyholder = address(0xA11CE);
    address agent = address(0xA6E17);
    address payoutAddr = address(0xBEEF);
    address counterpartyOk = address(0xC0FFEE);

    function setUp() public {
        usdc = new MockUSDC();
        gate = new MockWorldIdGate();
        hook = new MockSuretyHook(usdc);
        ensRegistry = new MockEnsSubRegistry();
        verifiableFactory = new MockVerifiableFactory();

        registry = new PolicyRegistry(
            ensRegistry, verifiableFactory, address(0xD00D) /* impl, unused by mock factory */, gate, usdc, "surety", address(this)
        );
        registry.setHook(hook);

        usdc.mint(policyholder, 1_000_000e6);
        vm.prank(policyholder);
        usdc.approve(address(registry), type(uint256).max);

        // PRD's invariant #2 (2x reserve) and TEAM_PLAN's SeedDemo ordering both assume backers fund
        // the reserve *before* any policy is issued — premiums alone can never reach 2x coverage
        // (Decision D4). Seed enough backing for the modest-coverage happy-path tests below.
        address backer = address(0xB0B);
        usdc.mint(backer, 1_000_000e6);
        vm.prank(backer);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(backer);
        hook.depositBacking(1_000_000e6);
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

    function _dnsName() internal pure returns (bytes memory) {
        return abi.encodePacked(bytes1(0x06), "agent1", bytes1(0x06), "surety", bytes1(0x03), "eth", bytes1(0x00));
    }

    ////////////////////////////////////////////////////////////////////////
    // issuePolicy — happy path
    ////////////////////////////////////////////////////////////////////////

    function test_issuePolicy_happyPath() public {
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 500e6, 1, 1);
        bytes32 node = _issue(p);

        PolicyRecord memory policy = registry.getPolicy(node);
        assertEq(policy.policyholder, policyholder);
        assertEq(policy.agent, agent);
        assertEq(policy.payoutAddr, payoutAddr);
        assertEq(policy.coverageLimit, 10_000e6);
        assertEq(policy.perTxCap, 500e6);
        assertEq(policy.tier, 1);
        assertEq(policy.streak, 0);
        assertEq(policy.paidOut, 0);
        assertTrue(policy.active);

        assertTrue(registry.isAllowed(node, counterpartyOk));
        assertFalse(registry.isAllowed(node, address(0x9999)));
        assertEq(registry.totalCoverage(), 10_000e6);

        // premium = 10000 * 5% * 1.25 * 1 = 625 USDC (new policy, PricingEngine fixture 1)
        assertEq(hook.premiumsDeposited(node), 625e6);
        assertEq(usdc.balanceOf(address(hook)), 1_000_000e6 + 625e6); // seeded backing + this premium
    }

    function test_issuePolicy_registersNonTransferableSubname() public {
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 500e6, 1, 1);
        _issue(p);

        assertEq(ensRegistry.registrationsCount(), 1);
        (string memory label, address owner,, address resolver, uint256 roleBitmap,) = ensRegistry.registrations(0);
        assertEq(label, "agent1");
        assertEq(owner, policyholder);
        assertTrue(resolver != address(0));
        // Non-transferable: ROLE_CAN_TRANSFER_ADMIN must never be included.
        assertEq(roleBitmap & EnsRoles.ROLE_CAN_TRANSFER_ADMIN, 0);
    }

    function test_issuePolicy_writesResolverRecordsAndScopesStreakRole() public {
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 500e6, 1, 1);
        _issue(p);

        (,,, address resolverAddr,,) = ensRegistry.registrations(0);
        MockEnsResolver resolver = MockEnsResolver(resolverAddr);
        bytes memory name = _dnsName();

        assertEq(resolver.textOf(name, "surety.coverageLimit"), "10000000000");
        assertEq(resolver.textOf(name, "surety.perTxCap"), "500000000");
        assertEq(resolver.textOf(name, "surety.tier"), "1");
        assertEq(resolver.textOf(name, "surety.streak"), "0");
        assertEq(resolver.textOf(name, "surety.status"), "active");
        assertEq(resolver.textOf(name, "surety.premium"), "625000000");

        assertEq(resolver.grantedSettersCount(), 1);
        (, address grantedTo) = resolver.grantedSetters(0);
        assertEq(grantedTo, agent);
    }

    ////////////////////////////////////////////////////////////////////////
    // issuePolicy — validation & reverts
    ////////////////////////////////////////////////////////////////////////

    function test_issuePolicy_revertsOnInvalidEnrollmentSig() public {
        gate.setEnrollmentValid(false);
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 500e6, 1, 1);
        vm.prank(policyholder);
        vm.expectRevert(PolicyRegistry.EnrollmentInvalid.selector);
        registry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function test_issuePolicy_revertsOnDuplicateLabel() public {
        IPolicyRegistry.IssueParams memory p = _params(1_000e6, 100e6, 1, 1);
        _issue(p);

        usdc.mint(policyholder, 1_000_000e6);
        IPolicyRegistry.IssueParams memory p2 = _params(1_000e6, 100e6, 1, 1);
        vm.prank(policyholder);
        vm.expectRevert();
        registry.issuePolicy(p2, bytes32(uint256(2)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function test_issuePolicy_revertsWhenTierBoundsNotMet() public {
        // tier 2 requires perTxCap <= 5% of coverage AND a non-empty allowlist.
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 600e6, 2, 1);
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.TierBoundsNotMet.selector, 2));
        registry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function test_issuePolicy_revertsWhenPerTxCapExceedsCoverage() public {
        IPolicyRegistry.IssueParams memory p = _params(1_000e6, 2_000e6, 0, 0);
        vm.prank(policyholder);
        vm.expectRevert(PolicyRegistry.InvalidParams.selector);
        registry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function test_issuePolicy_revertsWhenReserveBelow2x() public {
        // Coverage large enough that even the seeded 1,000,000 USDC of backing plus this policy's own
        // premium can't clear 2x that coverage.
        IPolicyRegistry.IssueParams memory p = _params(100_000_000e6, 5_000_000e6, 1, 1);
        usdc.mint(policyholder, 100_000_000e6);
        vm.prank(policyholder);
        vm.expectRevert();
        registry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    function test_issuePolicy_revertsWhenHookNotSet() public {
        PolicyRegistry freshRegistry = new PolicyRegistry(
            ensRegistry, verifiableFactory, address(0xD00D), gate, usdc, "surety", address(this)
        );
        IPolicyRegistry.IssueParams memory p = _params(10_000e6, 500e6, 1, 1);
        vm.prank(policyholder);
        vm.expectRevert(PolicyRegistry.HookNotSet.selector);
        freshRegistry.issuePolicy(p, bytes32(uint256(1)), uint64(block.timestamp + 1 hours), bytes(""));
    }

    ////////////////////////////////////////////////////////////////////////
    // updateStreak / recordPayout
    ////////////////////////////////////////////////////////////////////////

    function test_updateStreak_onlyAgent() public {
        bytes32 node = _issue(_params(10_000e6, 500e6, 1, 1));

        vm.prank(agent);
        registry.updateStreak(node, 7);
        assertEq(registry.getPolicy(node).streak, 7);

        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.NotAgent.selector, node, address(this)));
        registry.updateStreak(node, 99);
    }

    function test_recordPayout_onlyClaimRouter_updatesStateAndCoverage() public {
        bytes32 node = _issue(_params(10_000e6, 500e6, 1, 1));
        address claimRouter = address(0xC1A1);
        registry.setClaimRouter(claimRouter);

        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.NotClaimRouter.selector, address(this)));
        registry.recordPayout(node, 100e6);

        vm.prank(claimRouter);
        registry.recordPayout(node, 4_000e6);

        PolicyRecord memory policy = registry.getPolicy(node);
        assertEq(policy.paidOut, 4_000e6);
        assertEq(policy.claimsCount, 1);
        assertTrue(policy.active);
        assertEq(registry.totalCoverage(), 6_000e6);

        vm.prank(claimRouter);
        registry.recordPayout(node, 6_000e6);
        assertFalse(registry.getPolicy(node).active);
        assertEq(registry.totalCoverage(), 0);
    }
}
