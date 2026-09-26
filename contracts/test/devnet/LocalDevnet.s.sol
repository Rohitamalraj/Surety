// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {WorldIdGate} from "../../src/WorldIdGate.sol";
import {ViolationOracle} from "../../src/ViolationOracle.sol";
import {ClaimRouter} from "../../src/ClaimRouter.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {IWorldIdGate} from "../../src/interfaces/IWorldIdGate.sol";
import {ISuretyHook} from "../../src/interfaces/ISuretyHook.sol";
import {IViolationOracle} from "../../src/interfaces/IViolationOracle.sol";
import {PolicyRecord} from "../../src/interfaces/SuretyTypes.sol";
import {MockPolicyRegistry} from "../mocks/MockPolicyRegistry.sol";
import {MockAgentVault} from "../mocks/MockAgentVault.sol";
import {MockSuretyHook} from "../mocks/MockSuretyHook.sol";

/// @notice Local anvil devnet: Person B's real contracts + mocks of Person A's, with a seeded demo
/// policy. Lets the backend and frontend run the full flow before Sepolia contracts exist.
///
///   anvil
///   forge script test/devnet/LocalDevnet.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Uses anvil's default accounts: #0 deployer, #1 backend signer, #2 agent, #3 policyholder.
/// Writes ../deployments/local.json.
contract LocalDevnet is Script {
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant SIGNER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant AGENT_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant POLICYHOLDER_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;

    uint256 constant USDC = 1e6;
    bytes32 constant NODE = keccak256("agent1.surety.eth");
    /// @dev keccak256 of the pairwise sub "local-demo-sub" — use that sub in local World ID tests.
    bytes32 constant SUB_HASH = keccak256("local-demo-sub");

    address merchant = address(uint160(uint256(keccak256("surety.demo.merchant"))));
    address attacker = address(uint160(uint256(keccak256("surety.demo.attacker"))));
    address payout = address(uint160(uint256(keccak256("surety.demo.payout"))));

    MockPolicyRegistry registry;
    MockAgentVault vault;
    MockSuretyHook hook;
    WorldIdGate gate;
    ViolationOracle oracle;
    ClaimRouter router;

    function run() external {
        vm.startBroadcast(DEPLOYER_PK);
        _deploy();
        _seed();
        vm.stopBroadcast();
        _write();
    }

    function _deploy() internal {
        address deployer = vm.addr(DEPLOYER_PK);
        address signer = vm.addr(SIGNER_PK);
        registry = new MockPolicyRegistry();
        vault = new MockAgentVault();
        hook = new MockSuretyHook();
        gate = new WorldIdGate(signer, deployer);
        oracle = new ViolationOracle(IAgentVault(address(vault)), IPolicyRegistry(address(registry)), deployer);
        router = new ClaimRouter(
            IPolicyRegistry(address(registry)),
            IAgentVault(address(vault)),
            IViolationOracle(address(oracle)),
            IWorldIdGate(address(gate)),
            ISuretyHook(address(hook)),
            signer,
            deployer
        );
        registry.setRouter(address(router));
        hook.setRouter(address(router));
        vault.setRegistry(IPolicyRegistry(address(registry)));
        gate.setWiring(router, IPolicyRegistry(address(registry)));
    }

    function _seed() internal {
        hook.depositBacking(50_000 * USDC); // backing first, so the 2x reserve invariant holds
        registry.setPolicy(NODE, _demoPolicy());
        registry.setAllowed(NODE, merchant, true);
        hook.depositPremium(NODE, 500 * USDC);
    }

    function _demoPolicy() internal view returns (PolicyRecord memory p) {
        p.policyholder = vm.addr(POLICYHOLDER_PK);
        p.agent = vm.addr(AGENT_PK);
        p.payoutAddr = payout;
        p.coverageLimit = 10_000 * USDC;
        p.perTxCap = 500 * USDC;
        p.tier = 2;
        p.streak = 3;
        p.subHash = SUB_HASH;
        p.issuedAt = uint64(block.timestamp);
        p.active = true;
    }

    function _write() internal {
        string memory o = "local";
        vm.serializeAddress(o, "PolicyRegistry", address(registry));
        vm.serializeAddress(o, "AgentVault", address(vault));
        vm.serializeAddress(o, "SuretyHook", address(hook));
        vm.serializeAddress(o, "WorldIdGate", address(gate));
        vm.serializeAddress(o, "ViolationOracle", address(oracle));
        vm.serializeAddress(o, "ClaimRouter", address(router));
        vm.serializeUint(o, "deployBlock", block.number);
        string memory json = vm.serializeString(o, "demo", _demoJson());
        vm.writeJson(json, "../deployments/local.json");
        console.log("wrote deployments/local.json");
    }

    function _demoJson() internal returns (string memory) {
        string memory d = "demo";
        vm.serializeString(d, "label", "agent1");
        vm.serializeBytes32(d, "node", NODE);
        vm.serializeAddress(d, "agent", vm.addr(AGENT_PK));
        vm.serializeAddress(d, "policyholder", vm.addr(POLICYHOLDER_PK));
        vm.serializeAddress(d, "merchant", merchant);
        vm.serializeAddress(d, "attacker", attacker);
        return vm.serializeAddress(d, "payout", payout);
    }
}
