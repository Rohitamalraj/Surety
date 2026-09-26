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

/// @dev Owner-only setters on Person A's PolicyRegistry and SuretyHook.
interface IClaimRouterSetter {
    function setClaimRouter(address router) external;
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
    string[6] internal A_KEYS = ["MockUSDC", "PolicyRegistry", "AgentVault", "SuretyHook", "PoolManager", "WETH"];

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
