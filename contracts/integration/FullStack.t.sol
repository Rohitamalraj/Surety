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
import {WorldIdGate} from "../src/WorldIdGate.sol";
import {ViolationOracle} from "../src/ViolationOracle.sol";
import {ClaimRouter} from "../src/ClaimRouter.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IWorldIdGate} from "../src/interfaces/IWorldIdGate.sol";
import {ClaimStatus, ViolationType} from "../src/interfaces/SuretyTypes.sol";
import {DeployTrust} from "../script/DeployTrust.s.sol";

import {MockEnsSubRegistry} from "./mocks/MockEnsSubRegistry.sol";
import {MockVerifiableFactory} from "./mocks/MockVerifiableFactory.sol";

/// @notice Integration of both halves: Person A's real PolicyRegistry + AgentVault + SuretyHook on a real
/// v4 PoolManager, Person B's real WorldIdGate + ViolationOracle + ClaimRouter deployed and wired by
/// script/DeployTrust.s.sol's stages in the real order. Then the full PRD §23 demo: normal pay → attack
/// swap blocked → violation recorded → claim → World ID cancelled (held) → verified → paid from reserve.
contract FullStackTest is Deployers {
    uint256 constant DEPLOYER_PK = 0xD3910;
    uint256 constant SIGNER_PK = 0xB0B51;
    string constant FILE = "../deployments/fullstack-test.json";

    address deployer;
    address signer;
    address policyholder = address(0xA11CE);
    address agent = address(0xA6E17);
    address payoutAddr = address(0xBEEF);
    address merchant = address(0xC0FFEE);
    address attacker = address(0xBAD1BAD1);
    bytes32 constant SUB_HASH = keccak256("policyholder-pairwise-sub");

    MockUSDC usdc;
    MockUSDC weth;
    PolicyRegistry registry;
    AgentVault vault;
    SuretyHook hook;
    WorldIdGate gate;
    ViolationOracle oracle;
    ClaimRouter router;
    DeployTrust dt;
    PoolKey poolKey;
    bytes32 node;

    function setUp() public {
        deployer = vm.addr(DEPLOYER_PK);
        signer = vm.addr(SIGNER_PK);
        vm.setEnv("DEPLOYER_PK", vm.toString(DEPLOYER_PK));
        vm.setEnv("BACKEND_SIGNER", vm.toString(signer));
        vm.setEnv("DEPLOYMENTS_FILE", FILE);
        dt = new DeployTrust();

        // ---- stage 1 (B): gate first — PolicyRegistry needs it at construction
        gate = dt.stageGate();

        // ---- stage 2 (A): Person A's contracts, owned by the same deployer key
        deployFreshManagerAndRouters();
        usdc = new MockUSDC();
        weth = new MockUSDC();
        _deployA();
        _writeADeployments();

        // ---- stage 3 (B): oracle + router, wiring
        vm.setEnv("WORLD_ID_GATE", vm.toString(address(gate)));
        (oracle, router) = dt.stageClaims();

        // ---- stage 4 (A's SeedDemo equivalent): pool, backing first, policy, agent funds
        _seed();

        // ---- stage 5 (B): IDKit unique-human gate on for new enrollments
        dt.stageHumanGate();
    }

    function _deployA() internal {
        vm.startPrank(deployer);
        registry = new PolicyRegistry(
            new MockEnsSubRegistry(), new MockVerifiableFactory(), address(0xD00D), IWorldIdGate(address(gate)), usdc, "surety", deployer
        );
        vm.stopPrank();
        bytes memory args = abi.encode(manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), deployer);
        (address want, bytes32 salt) =
            HookMiner.find(address(this), uint160(Hooks.BEFORE_SWAP_FLAG), type(SuretyHook).creationCode, args);
        hook = new SuretyHook{salt: salt}(manager, IPolicyRegistry(address(registry)), IERC20(address(usdc)), deployer);
        require(address(hook) == want, "hook address");
        vault = new AgentVault(IPolicyRegistry(address(registry)), usdc, manager);
        vm.startPrank(deployer);
        registry.setHook(hook);
        hook.setAgentVault(address(vault));
        vm.stopPrank();
    }

    function _writeADeployments() internal {
        string memory o = "a";
        vm.serializeAddress(o, "MockUSDC", address(usdc));
        vm.serializeAddress(o, "PolicyRegistry", address(registry));
        vm.serializeAddress(o, "AgentVault", address(vault));
        vm.serializeAddress(o, "SuretyHook", address(hook));
        vm.serializeAddress(o, "PoolManager", address(manager));
        vm.writeJson(vm.serializeAddress(o, "WETH", address(weth)), FILE);
    }

    function _seed() internal {
        usdc.mint(address(this), 1e18);
        weth.mint(address(this), 1e18);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        weth.approve(address(modifyLiquidityRouter), type(uint256).max);
        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        (poolKey,) = initPoolAndAddLiquidity(c0, c1, hook, 3000, SQRT_PRICE_1_1);

        usdc.approve(address(hook), type(uint256).max);
        hook.depositBacking(1_000_000e6);

        usdc.mint(policyholder, 100_000e6);
        vm.startPrank(policyholder);
        usdc.approve(address(registry), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        address[] memory allow = new address[](1);
        allow[0] = merchant;
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        node = registry.issuePolicy(
            IPolicyRegistry.IssueParams("agent1", agent, payoutAddr, 10_000e6, 500e6, allow, 1),
            SUB_HASH,
            expiry,
            _sign(keccak256(abi.encode(gate.ENROLLMENT_TYPEHASH(), policyholder, SUB_HASH, expiry)))
        );
        vault.deposit(node, 5_000e6);
        vm.stopPrank();
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gate.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------- deploy script wiring

    function test_deployStagesWireEverything() public view {
        assertEq(gate.owner(), deployer);
        assertEq(gate.signer(), signer);
        assertEq(address(gate.router()), address(router));
        assertEq(address(gate.registry()), address(registry));
        assertTrue(gate.requireUniqueHuman());
        assertEq(registry.claimRouter(), address(router));
        assertEq(hook.claimRouter(), address(router));
        assertEq(router.backend(), signer);
        assertEq(address(router.hook()), address(hook));
        assertEq(address(oracle.vault()), address(vault));

        string memory json = vm.readFile(FILE);
        assertEq(vm.parseJsonAddress(json, ".ClaimRouter"), address(router));
        assertEq(vm.parseJsonAddress(json, ".WorldIdGate"), address(gate));
        assertEq(vm.parseJsonAddress(json, ".ViolationOracle"), address(oracle));
        assertEq(vm.parseJsonAddress(json, ".PolicyRegistry"), address(registry)); // A's keys preserved
        assertEq(vm.parseJsonAddress(json, ".WETH"), address(weth));
        assertEq(vm.parseJsonUint(json, ".pool.fee"), 3000);
    }

    // ---------------------------------------------------------------- PRD §23 end to end

    function test_fullDemo_blockedAttack_heldThenPaidClaim() public {
        // 1. normal payment
        vm.prank(agent);
        vault.pay(node, merchant, 100e6);

        // 2. Grok-style attack swap — blocked by the real hook, no funds move
        bool sellUsdc = Currency.unwrap(poolKey.currency0) == address(usdc);
        uint256 before = vault.balanceOf(node);
        vm.prank(agent);
        vm.expectRevert();
        vault.swap(
            node,
            poolKey,
            SwapParams(sellUsdc, -int256(4_000e6), sellUsdc ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT),
            attacker
        );
        assertEq(vault.balanceOf(node), before);

        // 3. rule-breaking transfer slips through → recomputable violation
        vm.prank(agent);
        uint256 paymentId = vault.pay(node, merchant, 800e6);
        assertEq(uint8(oracle.check(paymentId)), uint8(ViolationType.CapBreach));

        // 4. policyholder files; World ID cancelled → held, nothing paid
        vm.prank(policyholder);
        uint256 claimId = router.fileClaim(node, paymentId);
        vm.prank(signer);
        router.markHeld(claimId, "cancelled: access_denied");
        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Held));
        assertEq(usdc.balanceOf(payoutAddr), 0);

        // 5. fresh World ID by the same human → paid from the hook's liquid reserve
        vm.warp(block.timestamp + 30);
        uint64 authTime = uint64(block.timestamp - 5);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig =
            _sign(keccak256(abi.encode(gate.CLAIM_APPROVAL_TYPEHASH(), claimId, SUB_HASH, authTime, expiry)));
        uint256 reserveBefore = hook.liquidReserve();
        router.executeWithApproval(claimId, SUB_HASH, authTime, expiry, sig);

        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Paid));
        assertEq(usdc.balanceOf(payoutAddr), 800e6);
        assertEq(hook.liquidReserve(), reserveBefore - 800e6);
        assertEq(registry.getPolicy(node).paidOut, 800e6);
    }

    function test_humanGate_blocksUnverifiedNewEnrollment() public {
        address newcomer = address(0x7777);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(keccak256(abi.encode(gate.ENROLLMENT_TYPEHASH(), newcomer, SUB_HASH, expiry)));
        assertFalse(gate.verifyEnrollment(newcomer, SUB_HASH, expiry, sig));

        vm.prank(signer);
        gate.registerHuman(newcomer, 123);
        assertTrue(gate.verifyEnrollment(newcomer, SUB_HASH, expiry, sig));
    }
}
