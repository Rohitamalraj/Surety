// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IWorldIdGate} from "../../src/interfaces/IWorldIdGate.sol";

/// @notice A genuinely-functioning EIP-712 verifier matching IWorldIdGate exactly (PRD §15.7,
/// R-GATE-1/R-GATE-2) — real `ecrecover` against a real signature from a real generated keypair, real
/// replay protection, real expiry checks. Not a bool toggle.
///
/// This is deliberately *not* committed as `src/WorldIdGate.sol` — that file is Person B's ownership
/// (CLAUDE.md). It exists here, in the test tree, because no real WorldIdGate is deployed anywhere to
/// test PolicyRegistry's enrollment check against, and a stub that always returns `true` would prove
/// nothing about the real EIP-712 flow PolicyRegistry actually depends on. Every other dependency in
/// `contracts/test/fork/` is the real, currently-deployed Sepolia contract; this is the one exception,
/// clearly labeled, doing real cryptographic work rather than skipping it.
contract RealWorldIdGate is IWorldIdGate, EIP712 {
    using ECDSA for bytes32;

    bytes32 internal constant ENROLLMENT_TYPEHASH =
        keccak256("Enrollment(address policyholder,bytes32 subHash,uint64 expiry)");
    bytes32 internal constant CLAIM_APPROVAL_TYPEHASH =
        keccak256("ClaimApproval(uint256 claimId,bytes32 subHash,uint64 authTime,uint64 expiry)");

    address public signer;
    mapping(uint256 => bool) internal _approved;

    error InvalidSignature();
    error Expired(uint64 expiry, uint256 nowTs);
    error AlreadyApproved(uint256 claimId);

    constructor(address _signer) EIP712("Surety", "1") {
        signer = _signer;
    }

    function setSigner(address _signer) external {
        signer = _signer;
        emit SignerSet(_signer);
    }

    /// @inheritdoc IWorldIdGate
    function verifyEnrollment(address policyholder, bytes32 subHash, uint64 expiry, bytes calldata sig)
        external
        view
        returns (bool)
    {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > expiry) return false; // minute/hour-scale expiry; validator drift is irrelevant
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ENROLLMENT_TYPEHASH, policyholder, subHash, expiry)));
        (address recovered, ECDSA.RecoverError err,) = digest.tryRecover(sig);
        return err == ECDSA.RecoverError.NoError && recovered == signer;
    }

    /// @inheritdoc IWorldIdGate
    function approveClaim(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry, bytes calldata sig)
        external
    {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > expiry) revert Expired(expiry, block.timestamp); // minute/hour-scale expiry
        if (_approved[claimId]) revert AlreadyApproved(claimId);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_APPROVAL_TYPEHASH, claimId, subHash, authTime, expiry))
        );
        (address recovered, ECDSA.RecoverError err,) = digest.tryRecover(sig);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidSignature();

        _approved[claimId] = true;
        emit ClaimApproved(claimId, authTime);
    }

    /// @inheritdoc IWorldIdGate
    function isApproved(uint256 claimId) external view returns (bool) {
        return _approved[claimId];
    }

    /// @dev Exposes the EIP-712 digest so tests can sign it with `vm.sign` against a real private key.
    function enrollmentDigest(address policyholder, bytes32 subHash, uint64 expiry) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ENROLLMENT_TYPEHASH, policyholder, subHash, expiry)));
    }
}
