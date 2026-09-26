// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IWorldIdGate} from "./interfaces/IWorldIdGate.sol";
import {IClaimRouter} from "./interfaces/IClaimRouter.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {Claim, ClaimStatus} from "./interfaces/SuretyTypes.sol";

/// @title WorldIdGate
/// @notice On-chain half of the World ID for Agents checkpoint (PRD §11, §15.7).
/// The backend validates the OIDC id_token server-side (issuer, signature, audience, nonce,
/// auth_time freshness, pairwise sub) and signs an EIP-712 attestation. This contract trusts
/// only that signer, binds each approval to one claim, and blocks replay.
///
/// IDKit (PRD §11.2): before buying, a policyholder proves they are a unique human. The backend
/// verifies the IDKit proof with the World Developer Portal and records its action-scoped
/// nullifier here — one human, one wallet — so the shared pool can't be Sybil-farmed.
/// When `requireUniqueHuman` is on, enrollment is only valid for a verified-human wallet.
contract WorldIdGate is IWorldIdGate, EIP712, Ownable {
    bytes32 public constant ENROLLMENT_TYPEHASH =
        keccak256("Enrollment(address policyholder,bytes32 subHash,uint64 expiry)");
    bytes32 public constant CLAIM_APPROVAL_TYPEHASH =
        keccak256("ClaimApproval(uint256 claimId,bytes32 subHash,uint64 authTime,uint64 expiry)");

    /// @notice Max age of the World ID authentication at approval time.
    uint64 public constant MAX_AUTH_AGE = 10 minutes;
    /// @notice Tolerated clock skew between World ID's auth_time and block.timestamp.
    uint64 public constant CLOCK_SKEW = 2 minutes;

    address public signer;
    IClaimRouter public router;
    IPolicyRegistry public registry;

    mapping(uint256 claimId => bool) private _approved;

    /// @notice When true, verifyEnrollment also requires an IDKit proof-of-human for the policyholder.
    bool public requireUniqueHuman;
    mapping(address wallet => uint256 nullifier) public humanNullifier;
    mapping(uint256 nullifier => address wallet) public nullifierOwner;

    event HumanVerified(address indexed wallet, uint256 indexed nullifier);
    event RequireUniqueHumanSet(bool on);

    error InvalidSignature();
    error Expired();
    error AlreadyApproved(uint256 claimId);
    error ClaimNotOpen(uint256 claimId);
    error SubjectMismatch();
    error StaleAuthentication();
    error ZeroAddress();
    error NotSigner();
    error ZeroNullifier();
    error NullifierUsed(uint256 nullifier, address wallet);
    error WalletAlreadyVerified(address wallet);

    constructor(address signer_, address owner_) EIP712("Surety", "1") Ownable(owner_) {
        _setSigner(signer_);
    }

    // ---------------------------------------------------------------- admin

    function setSigner(address signer_) external onlyOwner {
        _setSigner(signer_);
    }

    /// @dev Wired after deploy to break the Gate <-> Router construction cycle.
    function setWiring(IClaimRouter router_, IPolicyRegistry registry_) external onlyOwner {
        if (address(router_) == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        router = router_;
        registry = registry_;
    }

    function setRequireUniqueHuman(bool on) external onlyOwner {
        requireUniqueHuman = on;
        emit RequireUniqueHumanSet(on);
    }

    // ---------------------------------------------------------------- IDKit proof of human

    /// @notice Records an IDKit nullifier the backend verified with the Developer Portal.
    /// A nullifier (one human, for Surety's action) can back exactly one wallet, forever.
    function registerHuman(address wallet, uint256 nullifier) external {
        if (msg.sender != signer) revert NotSigner();
        if (wallet == address(0)) revert ZeroAddress();
        if (nullifier == 0) revert ZeroNullifier();
        address existing = nullifierOwner[nullifier];
        if (existing != address(0)) revert NullifierUsed(nullifier, existing);
        if (humanNullifier[wallet] != 0) revert WalletAlreadyVerified(wallet);
        nullifierOwner[nullifier] = wallet;
        humanNullifier[wallet] = nullifier;
        emit HumanVerified(wallet, nullifier);
    }

    function isVerifiedHuman(address wallet) public view returns (bool) {
        return humanNullifier[wallet] != 0;
    }

    // ---------------------------------------------------------------- enrollment

    function verifyEnrollment(address policyholder, bytes32 subHash, uint64 expiry, bytes calldata sig)
        external
        view
        returns (bool)
    {
        if (block.timestamp > expiry) return false;
        if (requireUniqueHuman && !isVerifiedHuman(policyholder)) return false;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ENROLLMENT_TYPEHASH, policyholder, subHash, expiry)));
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError && recovered == signer;
    }

    // ---------------------------------------------------------------- claims

    function approveClaim(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry, bytes calldata sig)
        external
    {
        if (block.timestamp > expiry) revert Expired();
        if (_approved[claimId]) revert AlreadyApproved(claimId);

        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CLAIM_APPROVAL_TYPEHASH, claimId, subHash, authTime, expiry)));
        if (ECDSA.recover(digest, sig) != signer) revert InvalidSignature();

        Claim memory c = router.getClaim(claimId);
        if (c.status != ClaimStatus.Pending && c.status != ClaimStatus.Held) revert ClaimNotOpen(claimId);

        // Same human who bought the policy.
        if (registry.getPolicy(c.node).subHash != subHash) revert SubjectMismatch();

        // Fresh: authenticated after the claim was filed, and recently.
        if (authTime + CLOCK_SKEW < c.filedAt) revert StaleAuthentication();
        if (authTime > block.timestamp + CLOCK_SKEW) revert StaleAuthentication();
        if (block.timestamp > authTime + MAX_AUTH_AGE) revert StaleAuthentication();

        _approved[claimId] = true;
        emit ClaimApproved(claimId, authTime);
    }

    function isApproved(uint256 claimId) external view returns (bool) {
        return _approved[claimId];
    }

    /// @notice Exposed so the backend and tests can build the exact digest being signed.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _setSigner(address signer_) private {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }
}
