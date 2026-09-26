// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "v4-hooks/src/utils/HookMiner.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {ISuretyHook} from "../../src/interfaces/ISuretyHook.sol";

import {MockUSDC} from "../../src/MockUSDC.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {AgentVault} from "../../src/AgentVault.sol";
import {SuretyHook} from "../../src/SuretyHook.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {PolicyRecord, ViolationType} from "../../src/interfaces/SuretyTypes.sol";

import {IEnsEthRegistrar} from "../../src/interfaces/ens/IEnsEthRegistrar.sol";
import {IVerifiableFactory} from "../../src/interfaces/ens/IVerifiableFactory.sol";
import {IEnsUserRegistryInitializable} from "../../src/interfaces/ens/IEnsUserRegistryInitializable.sol";
import {Grant} from "../../src/interfaces/ens/IEnsResolverInitializable.sol";
import {IEnsSubRegistry} from "../../src/interfaces/ens/IEnsSubRegistry.sol";
import {IEnsEnhancedAccessControl} from "../../src/interfaces/ens/IEnsEnhancedAccessControl.sol";
import {IEnsTextResolver} from "../../src/interfaces/ens/IEnsTextResolver.sol";
import {IEnsExtendedResolver} from "../../src/interfaces/ens/IEnsExtendedResolver.sol";
import {IEnsRegistryReader} from "../../src/interfaces/ens/IEnsRegistryReader.sol";
import {IEnsPermissionedResolver} from "../../src/interfaces/ens/IEnsPermissionedResolver.sol";
import {EnsRoles} from "../../src/interfaces/ens/EnsRoles.sol";

import {RealWorldIdGate} from "../helpers/RealWorldIdGate.sol";
import {PolicyholderWalletFixture} from "../helpers/PolicyholderWalletFixture.sol";

interface IEnsTransferTest {
    function findTokenId(string calldata label) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function unsafeTransfer(address to, uint256 tokenId, bytes calldata data) external;
}

interface IUniversalResolverTest {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory, address);
}

interface IWethForkTest is IERC20 {
    function deposit() external payable;
    function decimals() external view returns (uint8);
}

/// @notice Local fork integration against deployed ENS and Uniswap contracts at a pinned Sepolia block.
/// Parent registration uses the deployed registrar's commit/reveal; policy records use deployed
/// factory/resolver/registry bytecode. Surety contracts and mintable tokens are created locally.
/// RealWorldIdGate is only a test EIP-712 verifier: no World ID session or production claim flow runs.
/// Tests use generated keys, cheatcode funding and simulated trusted-router calls. Nothing is broadcast.
/// `test_diagnostic_*` tests intentionally assert known-open, undecided-by-design behavior (streak
/// mirror divergence, enrollment-signature reuse against the test WorldIdGate) — their passing is not
/// release approval, just an honest record of what still needs a product decision. Real code defects
/// this review found (hookless-pool bypass, partial-fill over-debiting, unbounded recordPayout, stale
/// ENS status on exhaustion) were fixed in AgentVault.sol/PolicyRegistry.sol; the tests that used to
/// reproduce them (`test_real_*`, renamed from `test_diagnostic_*`) now confirm the fix instead — see
/// docs/INTEGRATION_REVIEW.md and docs/DEEP_VERIFICATION.md for the original findings.
contract RealSepoliaForkTest is Test {
    // Deployed Sepolia addresses exercised at SEPOLIA_FORK_BLOCK (default 11784342).
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant MODIFY_LIQUIDITY_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    address constant ETH_REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address constant VERIFIABLE_FACTORY = 0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C;
    address constant USER_REGISTRY_IMPL = 0xA80338aAA8D23831cEa25E858D1774534aBb0263;
    address constant PERMISSIONED_RESOLVER_IMPL = 0x14F09Fd05d4585759e54844DC9B00147131Cf243;
    /// @dev ENS's own deployed test token, used only to pay ETHRegistrar's real registration fee.
    address constant ENS_MOCK_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;

    /// @dev namehash("eth"), verified with `cast namehash eth` — see PolicyRegistry.sol.
    bytes32 constant ETH_NODE = 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;
    string constant PARENT_LABEL = "surety";

    MockUSDC usdc;
    MockUSDC weth; // our own second token, paired via the *real* PoolManager
    PolicyRegistry registry;
    AgentVault vault;
    SuretyHook hook;
    RealWorldIdGate gate;
    address ensParentRegistry; // our real UserRegistry proxy = surety.eth's own subregistry
    address lastResolverProxy; // set by _issueRealPolicy from the real PolicyResolverDeployed event
    PoolKey poolKey;

    address deployer;
    uint256 deployerPk;
    address policyholder;
    address agent = address(0xA6E17);
    address payoutAddr = address(0xBEEF);
    address allowedCounterparty = address(0xC0FFEE);
    address attackerCounterparty = address(0xBAD1BAD1);

    function setUp() public {
        // publicnode's free endpoint intermittently lacks archive state for specific accounts at this
        // pinned block even though current-tip queries work fine on it — verified live. Tenderly's
        // public gateway had full archive state for every account these tests touch.
        vm.createSelectFork(
            vm.envOr("SEPOLIA_RPC_URL_FORK", string("https://sepolia.gateway.tenderly.co")),
            vm.envOr("SEPOLIA_FORK_BLOCK", uint256(11784342))
        );

        (deployer, deployerPk) = makeAddrAndKey("suretyForkDeployer");
        policyholder = makeAddr("suretyForkPolicyholder");
        vm.deal(deployer, 10 ether);

        vm.startPrank(deployer);
        ensParentRegistry = _registerParentNameForReal();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        gate = new RealWorldIdGate(deployer); // deployer doubles as the backend signer for this test

        registry = new PolicyRegistry(
            IEnsSubRegistry(ensParentRegistry),
            IVerifiableFactory(VERIFIABLE_FACTORY),
            PERMISSIONED_RESOLVER_IMPL,
            gate,
            IERC20(address(usdc)),
            PARENT_LABEL,
            deployer
        );
        IEnsEnhancedAccessControl(ensParentRegistry).grantRootRoles(EnsRoles.ROLE_REGISTRAR, address(registry));

        vault = new AgentVault(
            IPolicyRegistry(address(registry)), IERC20(address(usdc)), IPoolManager(POOL_MANAGER), deployer
        );

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs =
            abi.encode(IPoolManager(POOL_MANAGER), IPolicyRegistry(address(registry)), IERC20(address(usdc)), deployer);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(deployer, flags, type(SuretyHook).creationCode, constructorArgs);
        hook = new SuretyHook{salt: salt}(
            IPoolManager(POOL_MANAGER), IPolicyRegistry(address(registry)), IERC20(address(usdc)), deployer
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        registry.setHook(hook);
        registry.setAgentVault(address(vault));
        hook.setAgentVault(address(vault));
        vm.stopPrank();

        _initializeRealPoolWithLiquidity();

        vm.prank(deployer);
        vault.setCanonicalPool(poolKey);

        // Fund the reserve *before* issuing any policy — the 2x invariant can't hold on premiums alone.
        address backer = makeAddr("suretyForkBacker");
        usdc.mint(backer, 1_000_000e6);
        vm.startPrank(backer);
        usdc.approve(address(hook), type(uint256).max);
        hook.depositBacking(1_000_000e6);
        vm.stopPrank();
    }

    ////////////////////////////////////////////////////////////////////////
    // The real, end-to-end story
    ////////////////////////////////////////////////////////////////////////

    function test_real_issuePolicyOnLiveEnsInfrastructure() public {
        bytes32 node = _issueRealPolicy();

        // Read the mirrored PolicyRecord back from our own contract...
        PolicyRecord memory policy = registry.getPolicy(node);
        assertEq(policy.policyholder, policyholder);
        assertEq(policy.coverageLimit, 10_000e6);
        assertTrue(policy.active);

        // ...and independently verify the *real* resolver instance actually holds the same data, read
        // through ENSIP-10, with an ENSIP-5 query payload. Discover the resolver from the registry
        // on each read; the deployment event alone does not prove the name points to that resolver.
        assertTrue(lastResolverProxy != address(0));
        assertEq(IEnsRegistryReader(ensParentRegistry).getResolver("agent1"), lastResolverProxy);
        assertEq(_readText("agent1", node, "surety.coverageLimit"), "10000000000");
        assertEq(_readText("agent1", node, "surety.perTxCap"), "500000000");
        assertEq(_readText("agent1", node, "surety.status"), "active");
        assertEq(_readText("agent1", node, "surety.missing"), "");

        console2.log("Real agent1.surety.eth issued on a live Sepolia fork. node:");
        console2.logBytes32(node);
        console2.log("Real per-policy resolver proxy:", lastResolverProxy);
        console2.log("Real surety.eth subregistry (UserRegistry proxy):", ensParentRegistry);
    }

    function test_real_textProfileRequiresWildcardEntryPoint() public {
        bytes32 node = _issueRealPolicy();
        address resolver = IEnsRegistryReader(ensParentRegistry).getResolver("agent1");
        (bool ok,) = resolver.staticcall(abi.encodeCall(IEnsTextResolver.text, (node, "surety.status")));
        assertFalse(ok, "pinned PermissionedResolver must reject standalone text()");
        assertEq(_readText("agent1", node, "surety.status"), "active");
        // AbstractRecordResolver derives the node from the DNS name, ignoring the payload node.
        assertEq(_readText("agent1", bytes32(0), "surety.status"), "active");
    }

    function test_real_policyIsDiscoverableThroughUniversalResolver() public {
        bytes32 node = _issueRealPolicy();
        IUniversalResolverTest universal =
            // forge-lint: disable-next-line(unsafe-typecast)
            IUniversalResolverTest(address(bytes20(hex"5d25c1d6acbb71b7a28aa7899618a3412a8303e3"))); // real UniversalResolverV2
        (bytes memory result, address resolvedBy) =
            universal.resolve(_dnsName("agent1"), abi.encodeCall(IEnsTextResolver.text, (node, "surety.coverageLimit")));
        assertEq(abi.decode(result, (string)), "10000000000");
        assertEq(resolvedBy, IEnsRegistryReader(ensParentRegistry).getResolver("agent1"));
    }

    function test_real_agentCannotChangeAddressOrEscalateSetterPermissions() public {
        _issueRealPolicy();
        IEnsPermissionedResolver resolver = IEnsPermissionedResolver(lastResolverProxy);
        bytes memory name = _dnsName("agent1");
        vm.prank(agent);
        vm.expectRevert();
        resolver.setAddress(name, 60, abi.encodePacked(agent));
        bytes memory setter = abi.encodeCall(resolver.setText, (name, "surety.coverageLimit", ""));
        vm.prank(agent);
        vm.expectRevert();
        resolver.grantSetterRoles(setter, agent);
    }

    function test_real_contractWalletCanReceivePolicyName() public {
        PolicyholderWalletFixture wallet = new PolicyholderWalletFixture(true);
        bytes32 subHash = keccak256("contract-wallet");
        uint64 expiry = uint64(block.timestamp + 1 hours);
        usdc.mint(address(wallet), 1_000e6);
        bytes32 node = wallet.buy(
            registry,
            usdc,
            _standardParams("wallet"),
            subHash,
            expiry,
            _enrollmentSignature(address(wallet), subHash, expiry, deployerPk)
        );
        assertEq(registry.getPolicy(node).policyholder, address(wallet));
        uint256 tokenId = IEnsTransferTest(ensParentRegistry).findTokenId("wallet");
        assertEq(IEnsTransferTest(ensParentRegistry).ownerOf(tokenId), address(wallet));
        assertEq(_readText("wallet", node, "surety.status"), "active");
    }

    function test_real_rejectedNameReceiptRollsBackPremiumAndRegistry() public {
        PolicyholderWalletFixture wallet = new PolicyholderWalletFixture(false);
        bytes32 subHash = keccak256("rejecting-wallet");
        uint64 expiry = uint64(block.timestamp + 1 hours);
        usdc.mint(address(wallet), 1_000e6);
        bytes memory sig = _enrollmentSignature(address(wallet), subHash, expiry, deployerPk);
        IPolicyRegistry.IssueParams memory p = _standardParams("rejectingwallet");
        vm.expectRevert();
        wallet.buy(registry, usdc, p, subHash, expiry, sig);
        assertEq(usdc.balanceOf(address(wallet)), 1_000e6);
        assertEq(hook.liquidReserve(), 1_000_000e6);
        assertEq(registry.totalCoverage(), 0);
        assertEq(IEnsRegistryReader(ensParentRegistry).getResolver("rejectingwallet"), address(0));
    }

    function test_real_swapWithDeployed18DecimalWeth() public {
        // forge-lint: disable-next-line(unsafe-typecast)
        IWethForkTest realWeth = IWethForkTest(address(bytes20(hex"7b79995e5f793a07bc00c21412e50ecae098e7f9"))); // real Sepolia WETH9
        assertEq(realWeth.decimals(), 18);
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 1_000e6);
        bool usdcFirst = address(usdc) < address(realWeth);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdcFirst ? address(usdc) : address(realWeth)),
            currency1: Currency.wrap(usdcFirst ? address(realWeth) : address(usdc)),
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });
        // Explicit TEST price: 2,500 USDC per WETH; raw token units include the 6/18 decimal gap.
        uint160 sqrtPrice = usdcFirst
            ? uint160(79228162514264337593543950336 * 20_000)
            : uint160(uint256(79228162514264337593543950336) / 20_000);
        IPoolManager(POOL_MANAGER).initialize(key, sqrtPrice);
        vm.deal(deployer, 100 ether);
        vm.startPrank(deployer);
        realWeth.deposit{value: 50 ether}();
        realWeth.approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);
        PoolModifyLiquidityTest(MODIFY_LIQUIDITY_ROUTER)
            .modifyLiquidity(
                key, ModifyLiquidityParams(TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 1e15, bytes32(0)), ""
            );
        // This test deliberately swaps through a *different* real pool (real 18-decimal WETH instead
        // of the fixture's mintable stand-in) than the one setUp pinned — repoint the vault at it.
        vault.setCanonicalPool(key);
        vm.stopPrank();

        SwapParams memory params = SwapParams({
            zeroForOne: usdcFirst,
            amountSpecified: -int256(250e6),
            sqrtPriceLimitX96: usdcFirst ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        vm.prank(agent);
        vault.swap(node, key, params, allowedCounterparty);
        assertEq(vault.balanceOf(node), 750e6);
        assertEq(usdc.balanceOf(address(vault)), 750e6);
        assertGt(realWeth.balanceOf(address(vault)), 0.09 ether);
        assertLt(realWeth.balanceOf(address(vault)), 0.1 ether);
        console2.log("250 MockUSDC swapped for WETH wei:", realWeth.balanceOf(address(vault)));
    }

    function test_real_agentCanOnlyWriteStreak() public {
        bytes32 node = _issueRealPolicy();
        IEnsPermissionedResolver resolver =
            IEnsPermissionedResolver(IEnsRegistryReader(ensParentRegistry).getResolver("agent1"));
        vm.prank(agent);
        resolver.setText(_dnsName("agent1"), "surety.streak", "7");
        assertEq(_readText("agent1", node, "surety.streak"), "7");

        vm.expectRevert();
        vm.prank(agent);
        resolver.setText(_dnsName("agent1"), "surety.coverageLimit", "999999999999");
        assertEq(_readText("agent1", node, "surety.coverageLimit"), "10000000000");
    }

    function test_real_streakPermissionIsIsolatedBetweenPolicies() public {
        address firstAgent = agent;
        bytes32 firstNode = _issueRealPolicy();
        address firstResolver = lastResolverProxy;
        agent = makeAddr("secondAgent");
        bytes32 secondNode = _issueRealPolicy("agent2");
        assertNotEq(firstResolver, lastResolverProxy);

        vm.prank(firstAgent);
        vm.expectRevert();
        IEnsPermissionedResolver(lastResolverProxy).setText(_dnsName("agent2"), "surety.streak", "100");

        vm.prank(agent);
        IEnsPermissionedResolver(lastResolverProxy).setText(_dnsName("agent2"), "surety.streak", "2");
        assertEq(_readText("agent2", secondNode, "surety.streak"), "2");
        assertEq(_readText("agent1", firstNode, "surety.streak"), "0");
    }

    function test_real_policyNameCannotBeTransferred() public {
        _issueRealPolicy();
        IEnsTransferTest parent = IEnsTransferTest(ensParentRegistry);
        uint256 tokenId = parent.findTokenId("agent1");
        assertEq(parent.ownerOf(tokenId), policyholder);
        address newOwner = makeAddr("newOwner");
        // The unsafe API bypasses emancipation checks, but must still enforce the transfer role.
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSignature("TransferDisallowed(uint256,address)", tokenId, policyholder));
        parent.unsafeTransfer(newOwner, tokenId, "");
        assertEq(parent.ownerOf(tokenId), policyholder);
    }

    function test_real_manipulatedAttackSwap_blockedOnLivePoolManager() public {
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 5_000e6);

        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        SwapParams memory attack = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: -int256(4_000e6), // far over the 500 USDC cap
            sqrtPriceLimitX96: sellingUsdc ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        uint256 balanceBefore = vault.balanceOf(node);
        vm.prank(agent);
        vm.expectRevert(); // wrapped PolicyViolation(node, CapBreach) — SuretyHook.t.sol decodes this exactly
        vault.swap(node, poolKey, attack, allowedCounterparty);

        assertEq(vault.balanceOf(node), balanceBefore, "attack swap must not move any funds on the real pool");
    }

    function test_real_normalPaymentAndRuleBreakingTransfer() public {
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 5_000e6);

        vm.prank(agent);
        vault.pay(node, allowedCounterparty, 200e6); // normal, within cap
        assertEq(vault.balanceOf(node), 4_800e6);

        vm.prank(agent);
        uint256 paymentId = vault.pay(node, attackerCounterparty, 4_500e6); // over cap; off allowlist
        assertEq(vault.balanceOf(node), 300e6);
        assertEq(usdc.balanceOf(attackerCounterparty), 4_500e6);

        // Publicly recomputable, same as AttackReplay.t.sol — the payment went through in full, and
        // anyone can independently see it breaks the published cap.
        PolicyRecord memory policy = registry.getPolicy(node);
        assertGt(vault.getPayment(paymentId).amount, policy.perTxCap);
    }

    /// @notice Hundreds of independent wallets share the real ENS registry and Uniswap pool.
    /// Claims are simulated at the trusted-router boundary; this does not test World ID or ClaimRouter.
    function test_stress_manyUsersConserveFundsAndReserve() public {
        uint256 users = vm.envOr("STRESS_USERS", uint256(256));
        require(users > 0 && users <= 1000, "STRESS_USERS must be 1..1000");
        // 32 independent backers add 100 million MockUSDC, beyond the fixture's initial million.
        for (uint256 i; i < 32; ++i) {
            address backer = makeAddr(string.concat("surety-stress-backer-", vm.toString(i)));
            usdc.mint(backer, 3_125_000e6);
            vm.startPrank(backer);
            usdc.approve(address(hook), 3_125_000e6);
            hook.depositBacking(3_125_000e6);
            vm.stopPrank();
        }
        // Test-only stand-in for the missing production claim router.
        vm.startPrank(deployer);
        registry.setClaimRouter(address(this));
        hook.setClaimRouter(address(this));
        vm.stopPrank();

        uint256 ledgerSum;
        uint256 totalInput;
        uint256 totalOutput;
        for (uint256 i; i < users; ++i) {
            (uint256 balance, uint256 input, uint256 output) = _exerciseUser(i);
            ledgerSum += balance;
            totalInput += input;
            totalOutput += output;
            assertEq(usdc.balanceOf(address(vault)), ledgerSum, "USDC ledgers must match custody after each user");
            assertEq(weth.balanceOf(address(vault)), totalOutput, "outputs must match actual pool deltas");
            assertEq(registry.totalCoverage(), (i + 1) * 9_900e6);
            assertEq(hook.liquidReserve(), 101_000_000e6 + (i + 1) * 525e6);
            assertGe(hook.liquidReserve(), 2 * registry.totalCoverage());
        }
        console2.log("Distinct policyholders and agents:", users);
        console2.log("Backers including fixture:", uint256(33));
        console2.log("Initial reserve in MockUSDC:", uint256(101_000_000));
        console2.log("Total deposited in MockUSDC:", users * 100_000);
        console2.log("Actual swap input, base units:", totalInput);
        console2.log("Actual swap output, base units:", totalOutput);
        console2.log("Final reserve, base units:", hook.liquidReserve());
        console2.log("Outstanding coverage, base units:", registry.totalCoverage());
    }

    function _exerciseUser(uint256 i) internal returns (uint256 balance, uint256 input, uint256 output) {
        string memory suffix = vm.toString(i);
        policyholder = makeAddr(string.concat("surety-stress-holder-", suffix));
        agent = makeAddr(string.concat("surety-stress-agent-", suffix));
        payoutAddr = makeAddr(string.concat("surety-stress-payout-", suffix));
        allowedCounterparty = makeAddr(string.concat("surety-stress-counterparty-", suffix));
        assertEq(policyholder.code.length, 0, "stress fixture requires a fresh EOA");
        string memory label = string.concat("stress", vm.toString(i));
        bytes32 node = _issueRealPolicy(label);
        assertEq(
            IEnsTransferTest(ensParentRegistry).ownerOf(IEnsTransferTest(ensParentRegistry).findTokenId(label)),
            policyholder
        );
        assertEq(_readText(label, node, "surety.coverageLimit"), "10000000000");
        assertEq(_readText(label, node, "surety.perTxCap"), "500000000");
        assertEq(_readText(label, node, "surety.premium"), "625000000");
        assertEq(registry.getPolicy(node).agent, agent);
        _fundAgent(node, 100_000e6);

        vm.prank(agent);
        uint256 id = vault.pay(node, allowedCounterparty, 250e6);
        assertEq(id, i + 1);
        assertEq(vault.getPayment(id).node, node);
        assertEq(usdc.balanceOf(allowedCounterparty), 250e6);
        vm.prank(policyholder);
        vault.withdraw(node, 750e6);

        input = (100 + i % 400) * 1e6;
        uint256 custodyBefore = usdc.balanceOf(address(vault));
        uint256 outputBefore = weth.balanceOf(address(vault));
        vm.prank(agent);
        vault.swap(node, poolKey, _swapParams(input), allowedCounterparty);
        assertEq(custodyBefore - usdc.balanceOf(address(vault)), input);
        output = weth.balanceOf(address(vault)) - outputBefore;
        assertGt(output, 0);
        balance = 99_000e6 - input;
        assertEq(vault.balanceOf(node), balance);

        vm.prank(policyholder); // owning a policy does not confer the agent's spending key
        vm.expectRevert(abi.encodeWithSelector(AgentVault.NotAgent.selector, node, policyholder));
        vault.pay(node, allowedCounterparty, 1);
        _assertBlockedSwap(node, 501e6, allowedCounterparty, ViolationType.CapBreach);
        _assertBlockedSwap(node, 100e6, attackerCounterparty, ViolationType.OffAllowlist);
        assertEq(vault.balanceOf(node), balance);

        // Exercise only the authorized reserve/accounting boundary; no claim eligibility is asserted.
        registry.recordPayout(node, 100e6);
        hook.releasePayout(i + 1, payoutAddr, 100e6);
        assertEq(usdc.balanceOf(payoutAddr), 100e6);
        assertEq(registry.getPolicy(node).paidOut, 100e6);
    }

    function _swapParams(uint256 input) internal view returns (SwapParams memory) {
        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        return SwapParams({
            zeroForOne: sellingUsdc,
            // forge-lint: disable-next-line(unsafe-typecast)
            amountSpecified: -int256(input), // always a bounded test USDC amount, never near int256 max
            sqrtPriceLimitX96: sellingUsdc ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function _assertBlockedSwap(bytes32 node, uint256 input, address to, ViolationType reason) internal {
        vm.prank(agent);
        (bool ok, bytes memory errorData) =
            address(vault).call(abi.encodeCall(vault.swap, (node, poolKey, _swapParams(input), to)));
        assertFalse(ok);
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(errorData), CustomRevert.WrappedError.selector); // selector extraction
        (address target,, bytes memory inner,) =
            abi.decode(_withoutSelector(errorData), (address, bytes4, bytes, bytes));
        assertEq(target, address(hook));
        assertEq(inner, abi.encodeWithSelector(ISuretyHook.PolicyViolation.selector, node, reason));
    }

    function _withoutSelector(bytes memory data) internal pure returns (bytes memory result) {
        result = new bytes(data.length - 4);
        for (uint256 i; i < result.length; ++i) {
            result[i] = data[i + 4];
        }
    }

    // These tests exercised real defects found by this review; each now confirms the fix instead.
    // See docs/ARCHITECTURE.md#uniswap / #ens and docs/INTEGRATION_REVIEW.md for the original findings.

    /// @dev Was test_diagnostic_hooklessPoolBypassesPolicy — AgentVault.swap now only accepts the
    /// owner-pinned canonicalPoolKey, so a hookless (or any non-canonical) pool is rejected outright.
    function test_real_hooklessPoolIsRejectedByVault() public {
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 5_000e6);
        PoolKey memory unprotected = poolKey;
        unprotected.hooks = IHooks(address(0));
        IPoolManager(POOL_MANAGER).initialize(unprotected, 79228162514264337593543950336);
        vm.startPrank(deployer);
        PoolModifyLiquidityTest(MODIFY_LIQUIDITY_ROUTER)
            .modifyLiquidity(unprotected, ModifyLiquidityParams(-120, 120, 1e18, bytes32(0)), "");
        vm.stopPrank();
        _assertBlockedSwap(node, 4_000e6, attackerCounterparty, ViolationType.CapBreach);

        uint256 balanceBefore = vault.balanceOf(node);
        vm.prank(agent);
        vm.expectRevert(AgentVault.UnauthorizedPool.selector);
        vault.swap(node, unprotected, _swapParams(4_000e6), attackerCounterparty);
        assertEq(vault.balanceOf(node), balanceBefore, "unauthorized-pool attempt must not move any funds");
    }

    /// @dev Was test_diagnostic_partialFillOverDebitsLedger — the vault now debits the actually-settled
    /// USDC delta, not the requested amount, so a near-empty partial fill leaves the ledger correct.
    function test_real_partialFillCreditsOnlyActualSpend() public {
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 1_000e6);
        SwapParams memory params = _swapParams(500e6);
        // One sqrt-price unit from the current 1:1 price forces an almost-empty partial fill.
        params.sqrtPriceLimitX96 =
            params.zeroForOne ? uint160(79228162514264337593543950335) : uint160(79228162514264337593543950337);
        vm.prank(agent);
        vault.swap(node, poolKey, params, allowedCounterparty);
        // Only the tiny actually-settled amount is debited — not the full 500 requested.
        assertGt(vault.balanceOf(node), 999e6);
        assertEq(usdc.balanceOf(address(vault)), vault.balanceOf(node), "custody must exactly match the ledger");
        console2.log("Actually spent, USDC base units:", 1_000e6 - vault.balanceOf(node));
    }

    /// @dev Was test_diagnostic_exhaustedPolicyHasStaleEnsAndStillSwaps — recordPayout now writes
    /// surety.status = "exhausted" on the real resolver when coverage is used up. Continuing to allow
    /// the agent to spend its own already-deposited balance after exhaustion is intentional, not a
    /// defect: coverageLimit bounds future claim payouts, not the agent's own vault balance.
    function test_real_exhaustedPolicyPublishesStatusAndStillSpendsOwnBalance() public {
        bytes32 node = _issueRealPolicy();
        _fundAgent(node, 1_000e6);
        vm.prank(deployer);
        registry.setClaimRouter(address(this));
        registry.recordPayout(node, 10_000e6);
        assertFalse(registry.getPolicy(node).active);
        assertEq(_readText("agent1", node, "surety.status"), "exhausted");
        vm.prank(agent);
        vault.swap(node, poolKey, _swapParams(100e6), allowedCounterparty);
        assertEq(vault.balanceOf(node), 900e6, "exhausted policy may still spend its own deposited balance");
    }

    function test_diagnostic_streakMirrorsDiverge() public {
        bytes32 node = _issueRealPolicy();
        vm.prank(agent);
        registry.updateStreak(node, 7);
        assertEq(registry.getPolicy(node).streak, 7);
        assertEq(_readText("agent1", node, "surety.streak"), "0");
        vm.prank(agent);
        IEnsPermissionedResolver(lastResolverProxy).setText(_dnsName("agent1"), "surety.streak", "123");
        assertEq(registry.getPolicy(node).streak, 7);
        assertEq(_readText("agent1", node, "surety.streak"), "123");
    }

    function test_real_reserveBoundaryRollsBackEnsAndPremium_thenRecovers() public {
        // With 1m backing and 625 premiums, 51 policies fit; the 52nd must roll back atomically.
        for (uint256 i; i < 51; ++i) {
            _issueRealPolicy(string.concat("capacity", vm.toString(i)));
        }
        IPolicyRegistry.IssueParams memory p = _standardParams("capacity51");
        bytes32 subHash = keccak256("capacity-sub");
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _enrollmentSignature(policyholder, subHash, expiry, deployerPk);
        uint256 walletBefore = usdc.balanceOf(policyholder);
        uint256 reserveBefore = hook.liquidReserve();
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSelector(IPolicyRegistry.InsufficientReserve.selector, 1_032_500e6, 1_040_000e6));
        registry.issuePolicy(p, subHash, expiry, sig);
        assertEq(usdc.balanceOf(policyholder), walletBefore, "premium must roll back");
        assertEq(hook.liquidReserve(), reserveBefore);
        assertEq(registry.totalCoverage(), 510_000e6);
        assertEq(IEnsRegistryReader(ensParentRegistry).getResolver("capacity51"), address(0));
        bytes32 node = keccak256(abi.encodePacked(registry.parentNode(), keccak256(bytes("capacity51"))));
        assertEq(registry.getPolicy(node).issuedAt, 0);

        usdc.mint(address(this), 7_500e6);
        usdc.approve(address(hook), 7_500e6);
        hook.depositBacking(7_500e6);
        vm.prank(policyholder);
        assertEq(registry.issuePolicy(p, subHash, expiry, sig), node);
        assertEq(hook.liquidReserve(), 2 * registry.totalCoverage(), "equality at 2x must succeed");
        assertEq(_readText("capacity51", node, "surety.status"), "active");
    }

    function test_real_enrollmentRejectsTamperingAndExpiry() public {
        IPolicyRegistry.IssueParams memory p = _standardParams("invalid");
        bytes32 subHash = keccak256("signature-test");
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory validSig = _enrollmentSignature(policyholder, subHash, expiry, deployerPk);
        bytes memory wrongSigner = _enrollmentSignature(policyholder, subHash, expiry, 999);
        bytes memory wrongWallet = _enrollmentSignature(agent, subHash, expiry, deployerPk);
        _expectInvalidEnrollment(p, bytes32(uint256(subHash) ^ 1), expiry, validSig);
        _expectInvalidEnrollment(p, subHash, expiry, wrongSigner);
        _expectInvalidEnrollment(p, subHash, expiry, wrongWallet);
        vm.warp(uint256(expiry) + 1);
        _expectInvalidEnrollment(p, subHash, expiry, validSig);
        assertEq(registry.totalCoverage(), 0);
        assertEq(hook.liquidReserve(), 1_000_000e6);
        assertEq(IEnsRegistryReader(ensParentRegistry).getResolver("invalid"), address(0));
    }

    function test_diagnostic_enrollmentCanBeReplayedAcrossPolicies() public {
        bytes32 subHash = keccak256("same-enrollment");
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _enrollmentSignature(policyholder, subHash, expiry, deployerPk);
        usdc.mint(policyholder, 2_000e6);
        vm.startPrank(policyholder);
        usdc.approve(address(registry), type(uint256).max);
        bytes32 first = registry.issuePolicy(_standardParams("replay1"), subHash, expiry, sig);
        bytes32 second = registry.issuePolicy(_standardParams("replay2"), subHash, expiry, sig);
        vm.stopPrank();
        assertNotEq(first, second);
        assertEq(registry.getPolicy(first).subHash, registry.getPolicy(second).subHash);
        // This is the test helper's behavior, not a finding about an absent production WorldIdGate.
        assertEq(registry.totalCoverage(), 20_000e6);
    }

    /// @dev Was test_diagnostic_routerCanOverpayOnePolicyUsingAnotherCoverage — recordPayout now bounds
    /// the credited amount at the policy's own remaining coverage, so one policy can no longer corrupt
    /// the shared totalCoverage invariant that every other policy's 2x reserve check depends on.
    function test_real_recordPayoutBoundsToOwnRemainingCoverage() public {
        bytes32 first = _issueRealPolicy("overpay1");
        _issueRealPolicy("overpay2");
        vm.prank(deployer);
        registry.setClaimRouter(address(this));
        registry.recordPayout(first, 15_000e6); // requests far more than this policy's 10,000 coverage
        assertEq(registry.getPolicy(first).paidOut, registry.getPolicy(first).coverageLimit);
        assertFalse(registry.getPolicy(first).active, "fully-paid-out policy must be exhausted");
        assertEq(registry.totalCoverage(), 10_000e6, "untouched second policy's coverage must be unaffected");
    }

    function _standardParams(string memory label) internal view returns (IPolicyRegistry.IssueParams memory) {
        address[] memory allowlist = new address[](1);
        allowlist[0] = allowedCounterparty;
        return IPolicyRegistry.IssueParams(label, agent, payoutAddr, 10_000e6, 500e6, allowlist, 1);
    }

    function _enrollmentSignature(address wallet, bytes32 subHash, uint64 expiry, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.enrollmentDigest(wallet, subHash, expiry));
        return abi.encodePacked(r, s, v);
    }

    function _expectInvalidEnrollment(
        IPolicyRegistry.IssueParams memory p,
        bytes32 subHash,
        uint64 expiry,
        bytes memory sig
    ) internal {
        vm.prank(policyholder);
        vm.expectRevert(PolicyRegistry.EnrollmentInvalid.selector);
        registry.issuePolicy(p, subHash, expiry, sig);
    }

    ////////////////////////////////////////////////////////////////////////
    // Real ETHRegistrar commit-reveal registration
    ////////////////////////////////////////////////////////////////////////

    function _registerParentNameForReal() internal returns (address userRegistryProxy) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: deployer, roleBitmap: EnsRoles.ROLE_REGISTRAR | EnsRoles.ROLE_REGISTRAR_ADMIN});
        bytes memory initData = abi.encodeCall(IEnsUserRegistryInitializable.initialize, (grants));
        userRegistryProxy = IVerifiableFactory(VERIFIABLE_FACTORY)
            .deployProxy(
                USER_REGISTRY_IMPL, uint256(keccak256(abi.encode("surety-fork-test", block.timestamp))), initData
            );

        IEnsEthRegistrar ethRegistrar = IEnsEthRegistrar(ETH_REGISTRAR);
        require(ethRegistrar.isAvailable(PARENT_LABEL), "surety.eth not available on Sepolia right now");

        bytes32 secret = keccak256("surety-fork-test-secret");
        uint64 duration = 365 days;
        bytes32 referrer = bytes32(0);

        bytes32 commitment = ethRegistrar.makeCommitment(
            PARENT_LABEL, deployer, secret, userRegistryProxy, address(0), duration, referrer
        );
        ethRegistrar.commit(commitment);
        vm.warp(block.timestamp + 61); // real MIN_COMMITMENT_AGE, verified live: 60s

        (uint256 base, uint256 premium) = ethRegistrar.getRegisterPrice(PARENT_LABEL, duration, ENS_MOCK_USDC);
        deal(ENS_MOCK_USDC, deployer, base + premium);
        IERC20(ENS_MOCK_USDC).approve(ETH_REGISTRAR, base + premium);

        ethRegistrar.register(
            PARENT_LABEL, deployer, secret, userRegistryProxy, address(0), duration, ENS_MOCK_USDC, referrer
        );
    }

    ////////////////////////////////////////////////////////////////////////
    // Real Uniswap v4 pool, real liquidity
    ////////////////////////////////////////////////////////////////////////

    function _initializeRealPoolWithLiquidity() internal {
        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: hook});
        IPoolManager(POOL_MANAGER).initialize(poolKey, 79228162514264337593543950336); // 1:1

        usdc.mint(deployer, 1_000_000_000_000e6);
        weth.mint(deployer, 1_000_000_000_000e6);
        vm.startPrank(deployer);
        usdc.approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);
        weth.approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);
        PoolModifyLiquidityTest(MODIFY_LIQUIDITY_ROUTER)
            .modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0}),
                bytes("")
            );
        vm.stopPrank();
    }

    ////////////////////////////////////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////////////////////////////////////

    function _dnsName(string memory label) internal pure returns (bytes memory) {
        require(bytes(label).length > 0 && bytes(label).length < 256, "invalid test label");
        // forge-lint: disable-next-line(unsafe-typecast)
        return abi.encodePacked(uint8(bytes(label).length), label, hex"06", PARENT_LABEL, hex"0365746800");
    }

    function _readText(string memory label, bytes32 node, string memory key) internal view returns (string memory) {
        address resolver = IEnsRegistryReader(ensParentRegistry).getResolver(label);
        require(resolver.code.length > 0, "name has no resolver contract");
        return abi.decode(
            IEnsExtendedResolver(resolver).resolve(_dnsName(label), abi.encodeCall(IEnsTextResolver.text, (node, key))),
            (string)
        );
    }

    function _issueRealPolicy() internal returns (bytes32 node) {
        return _issueRealPolicy("agent1");
    }

    function _issueRealPolicy(string memory label) internal returns (bytes32 node) {
        bytes32 subHash = keccak256(abi.encode("real-fork-test-sub", policyholder));
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes32 digest = gate.enrollmentDigest(policyholder, subHash, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(deployerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        usdc.mint(policyholder, 1_000e6);
        vm.startPrank(policyholder);
        usdc.approve(address(registry), type(uint256).max);

        address[] memory allowlist = new address[](1);
        allowlist[0] = allowedCounterparty;

        vm.recordLogs();
        node = registry.issuePolicy(
            IPolicyRegistry.IssueParams({
                label: label,
                agent: agent,
                payoutAddr: payoutAddr,
                coverageLimit: 10_000e6,
                perTxCap: 500e6,
                allowlist: allowlist,
                tier: 1
            }),
            subHash,
            expiry,
            sig
        );
        vm.stopPrank();

        lastResolverProxy = _findResolverFromLogs(node);
    }

    /// @dev `PolicyRegistry`'s own `VerifiableFactory` isn't guaranteed to expose
    /// `predictProxyAddress` (the version currently deployed on Sepolia doesn't — checked live with
    /// `cast call`, even though it's present in the `verifiable-factory` repo's `main` branch source;
    /// deployed bytecode can lag the latest source), so the resolver address is read back from the
    /// `PolicyResolverDeployed` event `PolicyRegistry` itself emits, not re-derived.
    function _findResolverFromLogs(bytes32 node) internal view returns (address resolver) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("PolicyResolverDeployed(bytes32,address)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(registry) && logs[i].topics.length > 1 && logs[i].topics[0] == sig
                    && logs[i].topics[1] == node
            ) {
                return abi.decode(logs[i].data, (address));
            }
        }
        revert("PolicyResolverDeployed event not found");
    }

    function _fundAgent(bytes32 node, uint256 amount) internal {
        usdc.mint(policyholder, amount);
        vm.startPrank(policyholder);
        usdc.approve(address(vault), amount);
        vault.deposit(node, amount);
        vm.stopPrank();
    }
}
