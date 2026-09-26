// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Claim, ViolationType} from "./SuretyTypes.sol";

/// @notice Owner: Person B. PRD §15.8. Its events form the public audit log.
interface IClaimRouter {
    event ClaimFiled(
        uint256 indexed claimId, bytes32 indexed node, uint256 paymentId, ViolationType vtype, uint256 amount
    );
    event ClaimHeld(uint256 indexed claimId, string reason);
    event ClaimPaid(uint256 indexed claimId, address to, uint256 amount);
    event ClaimRejected(uint256 indexed claimId, string reason);

    /// @dev Only the policyholder.
    function fileClaim(bytes32 node, uint256 paymentId) external returns (uint256 claimId);

    /// @dev Only the backend signer (World ID denied / expired / cancelled / mismatch).
    function markHeld(uint256 claimId, string calldata reason) external;

    /// @dev Requires WorldIdGate approval. Pays via SuretyHook.releasePayout.
    function execute(uint256 claimId) external;

    function getClaim(uint256 claimId) external view returns (Claim memory);
}
