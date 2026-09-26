// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {SuretyHook} from "../src/SuretyHook.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";

/// @notice Seeds the demo state PRD §23's script walks through: mint → **fund the reserve first** (so
/// `issuePolicy`'s 2x invariant can hold — premiums alone never reach it, TEAM_PLAN Decision D4) → issue
/// `agent1.surety.eth` → deposit the agent's spending balance.
///
/// The World ID enrollment signature isn't produced here — Person B's backend signs it server-side
/// after a real (or sandbox) World ID for Agents round trip (PRD §11.1). Pass the result through
/// `ENROLL_SUB_HASH` / `ENROLL_EXPIRY` / `ENROLL_SIG`. Reads contract addresses from
/// `deployments/sepolia.json` (written by `Deploy.s.sol`) rather than re-reading individual env vars.
///
/// NOT yet run against live Sepolia in this session — see Deploy.s.sol's header for why.
contract SeedDemo is Script {
    struct Deployed {
        MockUSDC usdc;
        PolicyRegistry registry;
        AgentVault vault;
        SuretyHook hook;
    }

    struct DemoParams {
        address policyholder;
        address agent;
        bytes32 subHash;
        uint64 expiry;
        bytes enrollSig;
        uint256 coverageLimit;
        uint256 perTxCap;
        uint256 backing;
        uint256 agentDeposit;
        address allowedCounterparty;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        Deployed memory d = _loadDeployments();
        DemoParams memory p = _loadDemoParams(vm.addr(deployerPk));

        vm.startBroadcast(deployerPk);
        bytes32 node = _seed(d, p, vm.addr(deployerPk));
        vm.stopBroadcast();

        console2.log("Seeded agent1.surety.eth, node:");
        console2.logBytes32(node);
    }

    function _loadDeployments() internal view returns (Deployed memory d) {
        string memory deployments = vm.readFile("../deployments/sepolia.json");
        d.usdc = MockUSDC(vm.parseJsonAddress(deployments, ".MockUSDC"));
        d.registry = PolicyRegistry(vm.parseJsonAddress(deployments, ".PolicyRegistry"));
        d.vault = AgentVault(vm.parseJsonAddress(deployments, ".AgentVault"));
        d.hook = SuretyHook(vm.parseJsonAddress(deployments, ".SuretyHook"));
    }

    function _loadDemoParams(address deployer) internal view returns (DemoParams memory p) {
        p.policyholder = vm.envOr("DEMO_POLICYHOLDER", deployer);
        p.agent = vm.envOr("DEMO_AGENT", deployer);
        p.subHash = vm.envBytes32("ENROLL_SUB_HASH");
        p.expiry = uint64(vm.envUint("ENROLL_EXPIRY"));
        p.enrollSig = vm.envBytes("ENROLL_SIG");
        p.coverageLimit = vm.envOr("DEMO_COVERAGE", uint256(10_000e6));
        p.perTxCap = vm.envOr("DEMO_PER_TX_CAP", uint256(500e6));
        p.backing = vm.envOr("DEMO_BACKING", uint256(1_000_000e6));
        p.agentDeposit = vm.envOr("DEMO_AGENT_DEPOSIT", uint256(5_000e6));
        p.allowedCounterparty = vm.envOr("DEMO_ALLOWED_COUNTERPARTY", deployer);
    }

    function _seed(Deployed memory d, DemoParams memory p, address deployer) internal returns (bytes32 node) {
        d.usdc.mint(deployer, p.backing + p.coverageLimit + p.agentDeposit);

        // Fund backing *first* — 2x reserve invariant can't hold on premiums alone (TEAM_PLAN D4).
        IERC20(address(d.usdc)).approve(address(d.hook), p.backing);
        d.hook.depositBacking(p.backing);

        address[] memory allowlist = new address[](1);
        allowlist[0] = p.allowedCounterparty;

        IERC20(address(d.usdc)).approve(address(d.registry), type(uint256).max);
        node = d.registry.issuePolicy(
            IPolicyRegistry.IssueParams({
                label: "agent1",
                agent: p.agent,
                payoutAddr: p.policyholder,
                coverageLimit: p.coverageLimit,
                perTxCap: p.perTxCap,
                allowlist: allowlist,
                tier: 1
            }),
            p.subHash,
            p.expiry,
            p.enrollSig
        );

        IERC20(address(d.usdc)).approve(address(d.vault), p.agentDeposit);
        d.vault.deposit(node, p.agentDeposit);
    }
}
