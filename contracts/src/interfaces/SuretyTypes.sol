// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared types for all Surety contracts. Locked at S0 — change only with team agreement.
/// All amounts are MockUSDC base units (6 decimals). `node` is the ENS namehash of the agent subname.

enum ViolationType {
    None,
    CapBreach,
    OffAllowlist,
    Attested
}

enum ClaimStatus {
    None,
    Pending,
    Held,
    Paid,
    Rejected
}

struct PolicyRecord {
    address policyholder;
    address agent; // agent's scoped key — may write `streak` only
    address payoutAddr; // fixed at purchase
    uint256 coverageLimit;
    uint256 perTxCap;
    uint8 tier;
    uint32 streak;
    uint32 claimsCount;
    bytes32 subHash; // keccak256(World ID pairwise sub)
    uint256 paidOut;
    uint64 issuedAt;
    bool active;
}

struct Payment {
    bytes32 node;
    address to;
    uint256 amount;
    uint64 timestamp;
}

struct Claim {
    bytes32 node;
    uint256 paymentId;
    ViolationType vtype;
    uint256 amount;
    ClaimStatus status;
    uint64 filedAt;
}
