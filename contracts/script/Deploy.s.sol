// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Constants} from "v4-core/test/utils/Constants.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks/src/utils/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {SuretyHook} from "../src/SuretyHook.sol";
import {PremiumYieldVault} from "../src/PremiumYieldVault.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IWorldIdGate} from "../src/interfaces/IWorldIdGate.sol";
import {IEnsSubRegistry} from "../src/interfaces/ens/IEnsSubRegistry.sol";
import {IVerifiableFactory} from "../src/interfaces/ens/IVerifiableFactory.sol";

/// @notice Deploys Person A's contracts (PRD §15.9 deploy order, steps 1, 3, 4, 5) and wires them to
/// dependencies that already exist by the time this runs:
///  - the real Sepolia Uniswap v4 PoolManager (`POOL_MANAGER`) — verified address in `.env.example`;
///  - the real ENSv2 beta `surety.eth` registry, `VerifiableFactory`, and `PermissionedResolverImpl`
///    (`ENS_PARENT_REGISTRY`, `ENS_VERIFIABLE_FACTORY`, `ENS_PERMISSIONED_RESOLVER_IMPL`) — the parent
///    name itself must already be registered on Sepolia (task A1, a one-time manual step via the ENS
///    app or a separate registration script — *not* done here);
///  - Person B's `WorldIdGate`/`ClaimRouter` (`WORLD_ID_GATE`, `CLAIM_ROUTER`) — if either is unset,
///    this deploys anyway and logs a warning; the corresponding calls (`issuePolicy`,
///    `recordPayout`/`releasePayout`) simply aren't usable until a follow-up script wires the real
///    addresses in (`registry.setHook`/`setClaimRouter`, `hook.setClaimRouter` are owner-only, so this
///    is safe to do as a second transaction once B's contracts land).
///
/// NOT yet run against live Sepolia in this session — no funded deployer wallet / RPC in this
/// environment. Written and compile-checked against the exact locked deploy order and verified
/// addresses in docs/ARCHITECTURE.md; run it for real once a funded `DEPLOYER_PK` is available.
contract Deploy is Script {
    /// @dev Foundry's standard deterministic CREATE2 deployer, used by `forge script` broadcasts —
    /// verified against docs.uniswap.org's own hook-deployment guide (docs/ARCHITECTURE.md#uniswap).
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    struct Config {
        uint256 deployerPk;
        address deployer;
        address poolManager;
        address weth;
        address ensParentRegistry;
        address verifiableFactory;
        address permissionedResolverImpl;
        string parentLabel;
        address worldIdGate;
        address claimRouter;
    }

    struct Deployed {
        MockUSDC usdc;
        PolicyRegistry registry;
        AgentVault vault;
        SuretyHook hook;
        PremiumYieldVault yieldVault;
    }

    function run() external {
        Config memory cfg = _loadConfig();

        vm.startBroadcast(cfg.deployerPk);
        Deployed memory d = _deployAndWire(cfg);
        _initializePool(cfg, d);
        vm.stopBroadcast();

        _writeDeploymentsJson(cfg, d);
    }

    function _loadConfig() internal view returns (Config memory cfg) {
        cfg.deployerPk = vm.envUint("DEPLOYER_PK");
        cfg.deployer = vm.addr(cfg.deployerPk);
        cfg.poolManager = vm.envAddress("POOL_MANAGER");
        cfg.weth = vm.envAddress("WETH");
        cfg.ensParentRegistry = vm.envAddress("ENS_PARENT_REGISTRY");
        cfg.verifiableFactory = vm.envAddress("ENS_VERIFIABLE_FACTORY");
        cfg.permissionedResolverImpl = vm.envAddress("ENS_PERMISSIONED_RESOLVER_IMPL");
        cfg.parentLabel = vm.envOr("ENS_PARENT_LABEL", string("surety"));
        cfg.worldIdGate = vm.envOr("WORLD_ID_GATE", address(0));
        cfg.claimRouter = vm.envOr("CLAIM_ROUTER", address(0));

        if (cfg.worldIdGate == address(0)) {
            console2.log("WARNING: WORLD_ID_GATE not set. issuePolicy() will revert until PolicyRegistry");
            console2.log("is redeployed with a real WorldIdGate - it is immutable here.");
        }
    }

    function _deployAndWire(Config memory cfg) internal returns (Deployed memory d) {
        // 1. MockUSDC
        d.usdc = new MockUSDC();

        // 3. PolicyRegistry(ens, gate, usdc)
        d.registry = new PolicyRegistry(
            IEnsSubRegistry(cfg.ensParentRegistry),
            IVerifiableFactory(cfg.verifiableFactory),
            cfg.permissionedResolverImpl,
            IWorldIdGate(cfg.worldIdGate),
            IERC20(address(d.usdc)),
            cfg.parentLabel,
            cfg.deployer
        );

        // 4. AgentVault(registry, usdc)
        d.vault = new AgentVault(
            IPolicyRegistry(address(d.registry)), IERC20(address(d.usdc)), IPoolManager(cfg.poolManager), cfg.deployer
        );

        // 5. SuretyHook via HookMiner(poolManager, registry, usdc)
        d.hook = _deployHook(cfg, d);

        // PRD §21.2 stretch #2 — premium yield split. Wholly optional: PolicyRegistry sends 100% of
        // every premium to the reserve exactly as before unless this is deployed and wired.
        d.yieldVault =
            new PremiumYieldVault(IERC20(address(d.usdc)), IPoolManager(cfg.poolManager), address(d.registry), cfg.deployer);
        d.registry.setPremiumYieldVault(address(d.yieldVault));
        d.hook.setPremiumYieldVault(address(d.yieldVault));
        d.yieldVault.setSuretyHook(address(d.hook));

        // 8. wire roles: registry<->hook, vault<->hook (router<->hook/registry deferred — see above)
        d.registry.setHook(d.hook);
        d.registry.setAgentVault(address(d.vault));
        d.hook.setAgentVault(address(d.vault));
        if (cfg.claimRouter != address(0)) {
            d.registry.setClaimRouter(cfg.claimRouter);
            d.hook.setClaimRouter(cfg.claimRouter);
        } else {
            console2.log("WARNING: CLAIM_ROUTER not set. recordPayout/releasePayout unusable until wired.");
        }
    }

    function _deployHook(Config memory cfg, Deployed memory d) internal returns (SuretyHook hook) {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(
            IPoolManager(cfg.poolManager), IPolicyRegistry(address(d.registry)), IERC20(address(d.usdc)), cfg.deployer
        );
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(SuretyHook).creationCode, constructorArgs);
        hook = new SuretyHook{salt: salt}(
            IPoolManager(cfg.poolManager), IPolicyRegistry(address(d.registry)), IERC20(address(d.usdc)), cfg.deployer
        );
        require(address(hook) == hookAddress, "Deploy: hook address mismatch");
    }

    // 9. initialize MockUSDC/WETH pool
    function _initializePool(Config memory cfg, Deployed memory d) internal {
        (Currency c0, Currency c1) = address(d.usdc) < cfg.weth
            ? (Currency.wrap(address(d.usdc)), Currency.wrap(cfg.weth))
            : (Currency.wrap(cfg.weth), Currency.wrap(address(d.usdc)));
        PoolKey memory poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: d.hook});
        IPoolManager(cfg.poolManager).initialize(poolKey, Constants.SQRT_PRICE_1_1);
        // Pin AgentVault.swap to exactly this pool — see AgentVault.sol's own header for why an
        // unpinned pool argument would let enforcement be skipped entirely.
        d.vault.setCanonicalPool(poolKey);

        // One-sided range just above the 1:1 starting price, wide enough to absorb typical premium
        // sizes as pure USDC (see PremiumYieldVault._addLiquidity) — re-tune via setPoolPosition if the
        // pool's real price drifts meaningfully from 1:1 before this is redeployed.
        bool usdcIsToken0 = Currency.unwrap(c0) == address(d.usdc);
        (int24 lower, int24 upper) = usdcIsToken0 ? (int24(60), int24(6000)) : (int24(-6000), int24(-60));
        d.yieldVault.setPoolPosition(poolKey, lower, upper);
    }

    // 10. write deployments/sepolia.json
    function _writeDeploymentsJson(Config memory cfg, Deployed memory d) internal {
        string memory json = "deployments";
        vm.serializeAddress(json, "MockUSDC", address(d.usdc));
        vm.serializeAddress(json, "PolicyRegistry", address(d.registry));
        vm.serializeAddress(json, "AgentVault", address(d.vault));
        vm.serializeAddress(json, "SuretyHook", address(d.hook));
        vm.serializeAddress(json, "PremiumYieldVault", address(d.yieldVault));
        vm.serializeAddress(json, "PoolManager", cfg.poolManager);
        string memory out = vm.serializeAddress(json, "WETH", cfg.weth);
        vm.writeJson(out, "../deployments/sepolia.json");
        console2.log("Wrote deployments/sepolia.json");
    }
}
