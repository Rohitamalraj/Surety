// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks/src/utils/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SuretyHook} from "../src/SuretyHook.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {ISuretyHook} from "../src/interfaces/ISuretyHook.sol";
import {PolicyRecord, ViolationType, Payment} from "../src/interfaces/SuretyTypes.sol";

import {MockWorldIdGate} from "./mocks/MockWorldIdGate.sol";
import {MockEnsSubRegistry} from "./mocks/MockEnsSubRegistry.sol";
import {MockVerifiableFactory} from "./mocks/MockVerifiableFactory.sol";

/// @notice The chain-layer half of PRD §8.2/§8.3 and §23's demo script, replaying the Grok/Bankr-style
/// attack against the *real* SuretyHook + PolicyRegistry + AgentVault wired together (only the external
/// ENS/World ID systems are mocked — see the header of each mock for why those are legitimate doubles,
/// not shortcuts around code this branch owns). Proves: (1) normal spending works, (2) a manipulated
/// over-cap *swap* is blocked before it executes — funds never move, (3) a rule-breaking *transfer*
/// is **not** blocked — it is recorded on-chain as the insured event, exactly as PRD §4.2 designs it.
///
/// The other half — file claim → ViolationOracle.check → World ID re-auth → ClaimRouter.execute →
/// paid from the reserve — is Person B's ClaimRouter/ViolationOracle/WorldIdGate (TEAM_PLAN §4, B7:
/// "extend AttackReplay.t.sol with the transfer-slips-through half"). `test_step4_violationIsPublicly
/// Recomputable` demonstrates the public-evidence property that half relies on, without needing B's
/// contracts to exist on this branch yet.
contract AttackReplayTest is Deployers {
    MockUSDC usdc;
    MockUSDC weth;
    MockWorldIdGate gate;
    MockEnsSubRegistry ensRegistry;
    MockVerifiableFactory verifiableFactory;

    PolicyRegistry registry;
    AgentVault vault;
    SuretyHook hook;
    PoolKey poolKey;

    address policyholder = address(0xA11CE);
    address agent = address(0xA6E17);
    address payoutAddr = address(0xBEEF);
    address allowedCounterparty = address(0xC0FFEE);
    address attackerCounterparty = address(0xBAD1BAD1);

    bytes32 node;
    uint256 constant COVERAGE = 10_000e6;
    uint256 constant PER_TX_CAP = 500e6;

    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockUSDC();
        weth = new MockUSDC();
        usdc.mint(address(this), 1_000_000_000_000e6);
        weth.mint(address(this), 1_000_000_000_000e6);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        weth.approve(address(modifyLiquidityRouter), type(uint256).max);

        gate = new MockWorldIdGate();
        ensRegistry = new MockEnsSubRegistry();
        verifiableFactory = new MockVerifiableFactory();

        registry = new PolicyRegistry(
            ensRegistry, verifiableFactory, address(0xD00D), gate, usdc, "surety", address(this)
        );

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs =
            abi.encode(manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), address(this));
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(SuretyHook).creationCode, constructorArgs);
        hook = new SuretyHook{salt: salt}(
            manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), address(this)
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        vault = new AgentVault(IPolicyRegistry(address(registry)), usdc, manager, address(this));

        registry.setHook(hook);
        registry.setAgentVault(address(vault));
        hook.setAgentVault(address(vault));

        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        (poolKey,) = initPoolAndAddLiquidity(c0, c1, hook, 3000, SQRT_PRICE_1_1);
        vault.setCanonicalPool(poolKey);

        // Backers fund the reserve *before* any policy is issued (PRD invariant #2 / TEAM_PLAN's
        // SeedDemo order) — premiums alone can never reach 2x coverage.
        address backer = address(0xB0B);
        usdc.mint(backer, 1_000_000e6);
        vm.prank(backer);
        usdc.approve(address(hook), type(uint256).max);
        vm.prank(backer);
        hook.depositBacking(1_000_000e6);

        // Enroll + issue agent1.surety.eth
        usdc.mint(policyholder, 1_000_000e6);
        vm.prank(policyholder);
        usdc.approve(address(registry), type(uint256).max);

        address[] memory allowlist = new address[](1);
        allowlist[0] = allowedCounterparty;
        IPolicyRegistry.IssueParams memory p = IPolicyRegistry.IssueParams({
            label: "agent1",
            agent: agent,
            payoutAddr: payoutAddr,
            coverageLimit: COVERAGE,
            perTxCap: PER_TX_CAP,
            allowlist: allowlist,
            tier: 1
        });
        vm.prank(policyholder);
        node = registry.issuePolicy(p, bytes32(uint256(42)), uint64(block.timestamp + 1 hours), bytes(""));

        // Policyholder funds the agent's spending balance.
        usdc.mint(policyholder, 5_000e6);
        vm.prank(policyholder);
        usdc.approve(address(vault), 5_000e6);
        vm.prank(policyholder);
        vault.deposit(node, 5_000e6);
    }

    /// @dev PRD §23 0:55–1:25 / §8.2 — normal spending within the published rules.
    function test_step1_normalPaymentsSucceed() public {
        vm.prank(agent);
        uint256 paymentId = vault.pay(node, allowedCounterparty, 200e6);
        assertEq(paymentId, 1);
        assertEq(vault.balanceOf(node), 4_800e6);
    }

    /// @dev PRD §8.2 / §23 0:55–1:25 — the Grok/Bankr-style attack: a manipulated agent tries to swap
    /// far more than its per-tx cap. The v4 hook reverts it before execution — funds never move.
    function test_step2_manipulatedAttackSwap_blockedBeforeExecution() public {
        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        SwapParams memory attackParams = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: -int256(4_000e6), // far over the 500 USDC cap
            sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        uint256 balanceBefore = vault.balanceOf(node);
        vm.prank(agent);
        vm.expectRevert(); // wrapped PolicyViolation(node, CapBreach) — see SuretyHook.t.sol for the
            // exact-decode version of this same assertion; this test's point is that the *balance*
            // never moves, i.e. the revert well and truly rolled back the whole swap.
        vault.swap(node, poolKey, attackParams, allowedCounterparty);

        assertEq(vault.balanceOf(node), balanceBefore, "attack swap must not move any funds");
    }

    /// @dev Same attack, off-allowlist counterparty instead of over-cap — also blocked.
    function test_step2b_offAllowlistSwap_blocked() public {
        bool sellingUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        SwapParams memory params = SwapParams({
            zeroForOne: sellingUsdc,
            amountSpecified: -int256(100e6), // within cap...
            sqrtPriceLimitX96: sellingUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });

        vm.prank(agent);
        vm.expectRevert(); // ...but off-allowlist counterparty
        vault.swap(node, poolKey, params, attackerCounterparty);
    }

    /// @dev PRD §4.2 / §8.3 / §23 0:55–1:25 — the other half of "enforce where you can, insure what
    /// gets through": a rule-breaking plain *transfer* is recorded, not blocked. This recorded breach
    /// is the insured event a claim will later reference.
    function test_step3_ruleBreakingTransfer_recordedNotBlocked() public {
        vm.prank(agent);
        uint256 paymentId = vault.pay(node, attackerCounterparty, 4_500e6); // over cap; off allowlist

        assertEq(vault.balanceOf(node), 500e6);
        assertEq(usdc.balanceOf(attackerCounterparty), 4_500e6);

        // The payment went through in full — pay() never blocks (PRD §15.4 R-VLT-1).
        assertEq(vault.getPayment(paymentId).amount, 4_500e6);
    }

    /// @dev PRD §13 — "why trust this was a real violation? re-run ViolationOracle.check(paymentId)
    /// yourself." Reproduces exactly that recomputation using only public on-chain data (the payment +
    /// the published policy), the same two checks the real ViolationOracle (Person B) will perform.
    function test_step4_violationIsPubliclyRecomputable() public {
        vm.prank(agent);
        uint256 paymentId = vault.pay(node, attackerCounterparty, 4_500e6);

        (bytes32 gotNode, address to, uint256 amount,) = _publicPaymentData(paymentId);
        PolicyRecord memory policy = registry.getPolicy(gotNode);

        ViolationType vtype = ViolationType.None;
        if (amount > policy.perTxCap) {
            vtype = ViolationType.CapBreach;
        } else if (!registry.isAllowed(gotNode, to)) {
            vtype = ViolationType.OffAllowlist;
        }

        assertTrue(vtype != ViolationType.None, "expected a recomputable violation");
        assertTrue(vtype == ViolationType.CapBreach); // this payment breaks the cap first, per R-ORA-1's order
    }

    function _publicPaymentData(uint256 paymentId)
        internal
        view
        returns (bytes32 paymentNode, address to, uint256 amount, uint64 timestamp)
    {
        Payment memory p = vault.getPayment(paymentId);
        return (p.node, p.to, p.amount, p.timestamp);
    }
}
