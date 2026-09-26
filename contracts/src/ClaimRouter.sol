// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IClaimRouter} from "./interfaces/IClaimRouter.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {IViolationOracle} from "./interfaces/IViolationOracle.sol";
import {IWorldIdGate} from "./interfaces/IWorldIdGate.sol";
import {ISuretyHook} from "./interfaces/ISuretyHook.sol";
import {Claim, ClaimStatus, Payment, PolicyRecord, ViolationType} from "./interfaces/SuretyTypes.sol";

/// @title ClaimRouter
/// @notice Claim lifecycle entry point (PRD §8.4, §15.8). Sequences Registry → Oracle → WorldIdGate → Hook.
/// Its events are the public audit log for claims.
contract ClaimRouter is IClaimRouter, Ownable {
    IPolicyRegistry public immutable registry;
    IAgentVault public immutable vault;
    IViolationOracle public immutable oracle;
    IWorldIdGate public immutable gate;
    ISuretyHook public immutable hook;

    /// @notice Backend EOA allowed to mark claims held after a failed World ID check.
    address public backend;

    uint256 public claimCount;
    mapping(uint256 claimId => Claim) private _claims;
    mapping(uint256 paymentId => bool) public paymentClaimed;

    error NotPolicyholder();
    error PolicyInactive();
    error PaymentNodeMismatch();
    error PaymentAlreadyClaimed(uint256 paymentId);
    error NoViolation(uint256 paymentId);
    error NothingToPay();
    error NotBackend();
    error ClaimNotOpen(uint256 claimId);
    error NotApproved(uint256 claimId);

    constructor(
        IPolicyRegistry registry_,
        IAgentVault vault_,
        IViolationOracle oracle_,
        IWorldIdGate gate_,
        ISuretyHook hook_,
        address backend_,
        address owner_
    ) Ownable(owner_) {
        registry = registry_;
        vault = vault_;
        oracle = oracle_;
        gate = gate_;
        hook = hook_;
        backend = backend_;
    }

    function setBackend(address backend_) external onlyOwner {
        backend = backend_;
    }

    // ---------------------------------------------------------------- lifecycle

    function fileClaim(bytes32 node, uint256 paymentId) external returns (uint256 claimId) {
        PolicyRecord memory policy = registry.getPolicy(node);
        if (msg.sender != policy.policyholder) revert NotPolicyholder();
        if (!policy.active) revert PolicyInactive();

        Payment memory payment = vault.getPayment(paymentId);
        if (payment.node != node) revert PaymentNodeMismatch();
        if (paymentClaimed[paymentId]) revert PaymentAlreadyClaimed(paymentId);

        ViolationType vtype = oracle.check(paymentId);
        if (vtype == ViolationType.None) revert NoViolation(paymentId);

        uint256 amount = _min(payment.amount, policy.coverageLimit - policy.paidOut);
        if (amount == 0) revert NothingToPay();

        paymentClaimed[paymentId] = true;
        claimId = ++claimCount;
        _claims[claimId] = Claim({
            node: node,
            paymentId: paymentId,
            vtype: vtype,
            amount: amount,
            status: ClaimStatus.Pending,
            filedAt: uint64(block.timestamp)
        });
        emit ClaimFiled(claimId, node, paymentId, vtype, amount);
    }

    function markHeld(uint256 claimId, string calldata reason) external {
        if (msg.sender != backend) revert NotBackend();
        Claim storage c = _claims[claimId];
        if (c.status != ClaimStatus.Pending && c.status != ClaimStatus.Held) revert ClaimNotOpen(claimId);
        c.status = ClaimStatus.Held;
        emit ClaimHeld(claimId, reason);
    }

    function execute(uint256 claimId) public {
        Claim storage c = _claims[claimId];
        if (c.status != ClaimStatus.Pending && c.status != ClaimStatus.Held) revert ClaimNotOpen(claimId);
        if (!gate.isApproved(claimId)) revert NotApproved(claimId);

        PolicyRecord memory policy = registry.getPolicy(c.node);
        Payment memory payment = vault.getPayment(c.paymentId);

        // Anti-self-dealing (invariant 3): money never goes back to the violating counterparty
        // or to the agent key that made the violating payment.
        if (policy.payoutAddr == payment.to) {
            _reject(claimId, "payout address is the violating counterparty");
            return;
        }
        if (policy.payoutAddr == policy.agent) {
            _reject(claimId, "payout address is the agent key");
            return;
        }

        // Coverage may have been consumed by other claims since filing.
        uint256 amount = _min(c.amount, policy.coverageLimit - policy.paidOut);
        if (amount == 0) {
            _reject(claimId, "coverage exhausted");
            return;
        }

        c.status = ClaimStatus.Paid;
        c.amount = amount;
        registry.recordPayout(c.node, amount);
        hook.releasePayout(claimId, policy.payoutAddr, amount);
        emit ClaimPaid(claimId, policy.payoutAddr, amount);
    }

    /// @notice One-transaction path for the demo: submit the backend's World ID approval and pay.
    function executeWithApproval(
        uint256 claimId,
        bytes32 subHash,
        uint64 authTime,
        uint64 expiry,
        bytes calldata sig
    ) external {
        gate.approveClaim(claimId, subHash, authTime, expiry, sig);
        execute(claimId);
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    // ---------------------------------------------------------------- internal

    function _reject(uint256 claimId, string memory reason) private {
        _claims[claimId].status = ClaimStatus.Rejected;
        emit ClaimRejected(claimId, reason);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
