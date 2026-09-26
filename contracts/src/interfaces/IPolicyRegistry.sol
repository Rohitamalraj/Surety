// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyRecord} from "./SuretyTypes.sol";

/// @notice Owner: Person A (ENS). PRD §15.3.
interface IPolicyRegistry {
    struct IssueParams {
        string label; // "agent1" -> agent1.surety.eth
        address agent;
        address payoutAddr;
        uint256 coverageLimit;
        uint256 perTxCap;
        address[] allowlist;
        uint8 tier;
    }

    event PolicyIssued(
        bytes32 indexed node,
        address indexed policyholder,
        address agent,
        uint256 coverageLimit,
        uint256 perTxCap,
        uint8 tier,
        uint256 premium
    );
    event StreakUpdated(bytes32 indexed node, uint32 streak);
    event PolicyExhausted(bytes32 indexed node);

    error InsufficientReserve(uint256 liquidReserve, uint256 required);

    /// @dev Pulls the premium in MockUSDC from msg.sender. Requires a valid WorldIdGate enrollment signature.
    function issuePolicy(IssueParams calldata p, bytes32 subHash, uint64 expiry, bytes calldata enrollSig)
        external
        returns (bytes32 node);

    /// @dev Only the policy's agent key.
    function updateStreak(bytes32 node, uint32 streak) external;

    /// @dev Only ClaimRouter. Increments paidOut and claimsCount; deactivates when exhausted.
    function recordPayout(bytes32 node, uint256 amount) external;

    function getPolicy(bytes32 node) external view returns (PolicyRecord memory);
    function isAllowed(bytes32 node, address counterparty) external view returns (bool);

    /// @dev Sum of (coverageLimit - paidOut) over active policies.
    function totalCoverage() external view returns (uint256);
}
