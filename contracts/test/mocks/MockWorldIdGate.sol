// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IWorldIdGate} from "../../src/interfaces/IWorldIdGate.sol";

/// @notice Test-only double for IWorldIdGate — Person B owns the real one. Enrollment validity is a
/// settable switch rather than real EIP-712 verification, since PolicyRegistry's tests are about
/// PolicyRegistry's own logic, not WorldIdGate's signature checking.
contract MockWorldIdGate is IWorldIdGate {
    bool public enrollmentValid = true;
    mapping(uint256 => bool) internal _approved;

    function setEnrollmentValid(bool ok) external {
        enrollmentValid = ok;
    }

    function verifyEnrollment(address, bytes32, uint64, bytes calldata) external view returns (bool) {
        return enrollmentValid;
    }

    function approveClaim(uint256 claimId, bytes32, uint64 authTime, uint64, bytes calldata) external {
        _approved[claimId] = true;
        emit ClaimApproved(claimId, authTime);
    }

    function isApproved(uint256 claimId) external view returns (bool) {
        return _approved[claimId];
    }
}
