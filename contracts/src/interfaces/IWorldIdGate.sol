// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Owner: Person B. PRD §15.7 / §11.
/// Verifies EIP-712 attestations signed by the backend after it validates World ID OIDC tokens server-side.
interface IWorldIdGate {
    event ClaimApproved(uint256 indexed claimId, uint64 authTime);
    event SignerSet(address signer);

    function verifyEnrollment(address policyholder, bytes32 subHash, uint64 expiry, bytes calldata sig)
        external
        view
        returns (bool);

    function approveClaim(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry, bytes calldata sig)
        external;

    function isApproved(uint256 claimId) external view returns (bool);
}
