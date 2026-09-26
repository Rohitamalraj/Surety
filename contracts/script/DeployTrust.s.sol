// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {WorldIdGate} from "../src/WorldIdGate.sol";
import {ViolationOracle} from "../src/ViolationOracle.sol";
import {ClaimRouter} from "../src/ClaimRouter.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {IWorldIdGate} from "../src/interfaces/IWorldIdGate.sol";
import {ISuretyHook} from "../src/interfaces/ISuretyHook.sol";
import {IViolationOracle} from "../src/interfaces/IViolationOracle.sol";
import {PolicyRecord} from "../src/interfaces/SuretyTypes.sol";

/// @dev Owner-only setters on Person A's PolicyRegistry and SuretyHook.
interface IClaimRouterSetter {
    function setClaimRouter(address router) external;
}

/// @dev ENSv2 EnhancedAccessControl on surety.eth's UserRegistry — lets PolicyRegistry mint subnames.
interface IEnsRootRoles {
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
}

/// @dev Backing: MockUSDC is publicly mintable on testnet; the hook pulls it via transferFrom.
interface ITestUsdc {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

interface IBackingHook {
    function depositBacking(uint256 amount) external;
    function liquidReserve() external view returns (uint256);
}

interface IPolicyView {
    function getPolicy(bytes32 node) external view returns (PolicyRecord memory);
}

/// @dev PolicyRegistry takes the gate in its constructor and keeps it immutable.
interface IRegistryGate {
    function worldIdGate() external view returns (address);
}

/// @title DeployTrust
/// @notice Person B's half of the Sepolia deploy (PRD §15.9). Interleaves with Person A's Deploy.s.sol,
/// because PolicyRegistry needs the gate at construction and the gate/registry/hook need the router:
///
///   1. STAGE=gate      forge script script/DeployTrust.s.sol --rpc-url sepolia --broadcast --verify
///                      → deploys WorldIdGate; prints WORLD_ID_GATE for step 2
///   2. (Person A)      WORLD_ID_GATE=0x… forge script script/Deploy.s.sol …  → writes deployments/sepolia.json
///   3. STAGE=claims    WORLD_ID_GATE=0x… forge script script/DeployTrust.s.sol …
///                      → deploys ViolationOracle + ClaimRouter, wires gate/registry/hook to the router,
///                        adds B's addresses + pool info to deployments/sepolia.json
///   4. (Person A)      SeedDemo.s.sol — the demo policyholder must already hold a backend enrollment sig
///   5. STAGE=human-gate forge script script/DeployTrust.s.sol …
///                      → turns on the IDKit unique-human requirement for every *new* enrollment.
///                        Done after seeding so the scripted demo policy isn't blocked by it.
///
/// Env: DEPLOYER_PK (must be the same owner key Person A deploys with — it owns the setters),
/// BACKEND_SIGNER (address of the backend's BACKEND_SIGNER_PK), WORLD_ID_GATE (stages 3 and 5),
/// DEPLOYMENTS_FILE (optional, default ../deployments/sepolia.json).
contract DeployTrust is Script {
    string internal constant DEFAULT_FILE = "../deployments/sepolia.json";

    /// @dev Address keys Person A's Deploy.s.sol writes; preserved when this script rewrites the file.
    string[7] internal A_KEYS =
        ["MockUSDC", "PolicyRegistry", "AgentVault", "SuretyHook", "PremiumYieldVault", "PoolManager", "WETH"];

    /// @dev ENSv2 PermissionedRegistry role that lets an account register subnames.
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;

    /// @dev Indexer backfill starts this many blocks before the claims stage (~1.6h on Sepolia),
    /// comfortably covering Person A's deploy that runs just before it.
    uint256 internal constant BACKFILL_BLOCKS = 500;

    error UnknownStage(string stage);
    error RegistryUsesDifferentGate(address registryGate, address expected);

    function run() external {
        string memory stage = vm.envString("STAGE");
        bytes32 s = keccak256(bytes(stage));
        if (s == keccak256("gate")) stageGate();
        else if (s == keccak256("claims")) stageClaims();
        else if (s == keccak256("human-gate")) stageHumanGate();
        else if (s == keccak256("back")) stageBack();
        else if (s == keccak256("demo")) stageDemo();
        else revert UnknownStage(stage);
    }

    // ---------------------------------------------------------------- stage 1

    function stageGate() public returns (WorldIdGate gate) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address signer = vm.envAddress("BACKEND_SIGNER");

        vm.startBroadcast(pk);
        gate = new WorldIdGate(signer, vm.addr(pk));
        vm.stopBroadcast();

        console2.log("WorldIdGate:", address(gate));
        console2.log("Next: Person A runs Deploy.s.sol with");
        console2.log("  WORLD_ID_GATE=", address(gate));
    }

    // ---------------------------------------------------------------- stage 3

    struct AAddrs {
        address registry;
        address vault;
        address hook;
    }

    function stageClaims() public returns (ViolationOracle oracle, ClaimRouter router) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(pk);
        address signer = vm.envAddress("BACKEND_SIGNER");
        WorldIdGate gate = WorldIdGate(vm.envAddress("WORLD_ID_GATE"));
        AAddrs memory a = _readA();

        // Fail loudly if Person A's registry was deployed against some other gate — it's immutable there.
        address registryGate = IRegistryGate(a.registry).worldIdGate();
        if (registryGate != address(gate)) revert RegistryUsesDifferentGate(registryGate, address(gate));

        vm.startBroadcast(pk);
        oracle = new ViolationOracle(IAgentVault(a.vault), IPolicyRegistry(a.registry), owner);
        router = new ClaimRouter(
            IPolicyRegistry(a.registry),
            IAgentVault(a.vault),
            IViolationOracle(address(oracle)),
            IWorldIdGate(address(gate)),
            ISuretyHook(a.hook),
            signer,
            owner
        );
        gate.setWiring(router, IPolicyRegistry(a.registry));
        IClaimRouterSetter(a.registry).setClaimRouter(address(router));
        IClaimRouterSetter(a.hook).setClaimRouter(address(router));
        // Person A's Deploy.s.sol leaves this to whoever owns surety.eth's registry: let PolicyRegistry
        // register <agent>.surety.eth subnames.
        address parent = vm.envOr("ENS_PARENT_REGISTRY", address(0));
        if (parent != address(0) && !IEnsRootRoles(parent).hasRootRoles(ROLE_REGISTRAR, a.registry)) {
            IEnsRootRoles(parent).grantRootRoles(ROLE_REGISTRAR, a.registry);
        }
        vm.stopBroadcast();

        _writeAll(address(gate), address(oracle), address(router));
        console2.log("ViolationOracle:", address(oracle));
        console2.log("ClaimRouter:    ", address(router));
    }

    // ---------------------------------------------------------------- stage 5

    function stageHumanGate() public {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        WorldIdGate gate = WorldIdGate(vm.envAddress("WORLD_ID_GATE"));
        bool on = vm.envOr("REQUIRE_UNIQUE_HUMAN", true);
        vm.startBroadcast(pk);
        gate.setRequireUniqueHuman(on);
        vm.stopBroadcast();
        console2.log("requireUniqueHuman:", on);
    }

    // ---------------------------------------------------------------- reserve backing

    /// @notice Funds the liquid reserve (the 2x-coverage invariant needs backers before any policy).
    /// BACKING in whole test-USDC (default 50,000). STAGE=back.
    function stageBack() public {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address me = vm.addr(pk);
        string memory json = vm.readFile(_file());
        ITestUsdc usdc = ITestUsdc(vm.parseJsonAddress(json, ".MockUSDC"));
        IBackingHook hook = IBackingHook(vm.parseJsonAddress(json, ".SuretyHook"));
        uint256 amount = vm.envOr("BACKING", uint256(50_000)) * 1e6;

        vm.startBroadcast(pk);
        if (usdc.balanceOf(me) < amount) usdc.mint(me, amount);
        usdc.approve(address(hook), amount);
        hook.depositBacking(amount);
        vm.stopBroadcast();
        console2.log("liquid reserve now:", hook.liquidReserve());
    }

    // ---------------------------------------------------------------- demo actors

    /// @notice After the policy is bought through the app, records who the backend's demo agent is,
    /// which counterparty is on the allowlist and which one is the attacker. Reads the rest from the
    /// real on-chain policy. Env: DEMO_LABEL, DEMO_MERCHANT, DEMO_ATTACKER. STAGE=demo (no broadcast).
    function stageDemo() public {
        string memory label = vm.envString("DEMO_LABEL");
        string memory json = vm.readFile(_file());
        bytes32 node = _namehash(label);
        PolicyRecord memory p = IPolicyView(vm.parseJsonAddress(json, ".PolicyRegistry")).getPolicy(node);
        require(p.issuedAt != 0, "no policy for DEMO_LABEL - buy it in the app first");

        string memory d = "demo";
        vm.serializeString(d, "label", label);
        vm.serializeBytes32(d, "node", node);
        vm.serializeAddress(d, "agent", p.agent);
        vm.serializeAddress(d, "policyholder", p.policyholder);
        vm.serializeAddress(d, "payout", p.payoutAddr);
        vm.serializeAddress(d, "merchant", vm.envAddress("DEMO_MERCHANT"));
        string memory demo = vm.serializeAddress(d, "attacker", vm.envAddress("DEMO_ATTACKER"));
        vm.writeJson(demo, _file(), ".demo");
        console2.log("demo block written for", label);
    }

    /// @dev namehash("<label>.surety.eth") — same node PolicyRegistry and the frontend compute.
    function _namehash(string memory label) internal pure returns (bytes32) {
        bytes32 eth = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        bytes32 parent = keccak256(abi.encodePacked(eth, keccak256("surety")));
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }

    // ---------------------------------------------------------------- deployments file

    function _file() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_FILE", string(DEFAULT_FILE));
    }

    function _readA() internal view returns (AAddrs memory a) {
        string memory json = vm.readFile(_file());
        a.registry = vm.parseJsonAddress(json, ".PolicyRegistry");
        a.vault = vm.parseJsonAddress(json, ".AgentVault");
        a.hook = vm.parseJsonAddress(json, ".SuretyHook");
    }

    /// @dev Rewrites the whole file: Person A's keys as found, plus B's contracts, the v4 pool key
    /// the backend's demo agent swaps through, and the indexer's backfill block.
    function _writeAll(address gate, address oracle, address router) internal {
        string memory json = vm.readFile(_file());
        string memory o = "deployments";
        for (uint256 i = 0; i < A_KEYS.length; i++) {
            string memory path = string.concat(".", A_KEYS[i]);
            if (vm.keyExistsJson(json, path)) vm.serializeAddress(o, A_KEYS[i], vm.parseJsonAddress(json, path));
        }
        if (vm.keyExistsJson(json, ".pool") == false) {
            string memory pool = _poolJson(json);
            if (bytes(pool).length > 0) vm.serializeString(o, "pool", pool);
        }
        vm.serializeAddress(o, "WorldIdGate", gate);
        vm.serializeAddress(o, "ViolationOracle", oracle);
        vm.serializeUint(o, "deployBlock", block.number > BACKFILL_BLOCKS ? block.number - BACKFILL_BLOCKS : 0);
        string memory out = vm.serializeAddress(o, "ClaimRouter", router);
        vm.writeJson(out, _file());
        console2.log("Updated", _file());
    }

    /// @dev Same PoolKey Person A's Deploy.s.sol initializes: MockUSDC/WETH, fee 3000, spacing 60.
    function _poolJson(string memory json) internal returns (string memory) {
        if (!vm.keyExistsJson(json, ".MockUSDC") || !vm.keyExistsJson(json, ".WETH")) return "";
        address usdc = vm.parseJsonAddress(json, ".MockUSDC");
        address weth = vm.parseJsonAddress(json, ".WETH");
        (address c0, address c1) = usdc < weth ? (usdc, weth) : (weth, usdc);
        string memory p = "pool";
        vm.serializeAddress(p, "currency0", c0);
        vm.serializeAddress(p, "currency1", c1);
        vm.serializeUint(p, "fee", 3000);
        return vm.serializeUint(p, "tickSpacing", 60);
    }
}
