// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IViolationOracle} from "./interfaces/IViolationOracle.sol";
import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {Payment, PolicyRecord, ViolationType} from "./interfaces/SuretyTypes.sol";

/// @title ViolationOracle
/// @notice Recomputes whether a recorded AgentVault payment broke its policy (PRD §13).
/// CapBreach and OffAllowlist use only public on-chain data — anyone can re-run `check`.
/// Attested (stretch) is a third-party risk verdict, labeled separately.
contract ViolationOracle is IViolationOracle, Ownable {
    IAgentVault public immutable vault;
    IPolicyRegistry public immutable registry;

    address public attester;
    mapping(uint256 paymentId => bool) public attested;

    error NotAttester();

    constructor(IAgentVault vault_, IPolicyRegistry registry_, address owner_) Ownable(owner_) {
        vault = vault_;
        registry = registry_;
    }

    function check(uint256 paymentId) external view returns (ViolationType) {
        Payment memory p = vault.getPayment(paymentId);
        if (p.node == bytes32(0)) return ViolationType.None;

        PolicyRecord memory policy = registry.getPolicy(p.node);
        if (p.amount > policy.perTxCap) return ViolationType.CapBreach;
        if (!registry.isAllowed(p.node, p.to)) return ViolationType.OffAllowlist;
        if (attested[paymentId]) return ViolationType.Attested;
        return ViolationType.None;
    }

    // ---------------------------------------------------------------- attested evidence (stretch)

    function setAttester(address attester_) external onlyOwner {
        attester = attester_;
    }

    function attest(uint256 paymentId) external {
        if (msg.sender != attester) revert NotAttester();
        attested[paymentId] = true;
        emit ViolationAttested(paymentId, msg.sender);
    }
}
