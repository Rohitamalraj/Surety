// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {PolicyRecord} from "../../src/interfaces/SuretyTypes.sol";

/// @dev Test stand-in for Person A's PolicyRegistry. Only the parts ClaimRouter / Oracle / Gate read.
contract MockPolicyRegistry is IPolicyRegistry {
    mapping(bytes32 => PolicyRecord) internal _policies;
    mapping(bytes32 => mapping(address => bool)) internal _allowed;
    address public router;

    function setRouter(address r) external {
        router = r;
    }

    function setPolicy(bytes32 node, PolicyRecord memory p) external {
        _policies[node] = p;
    }

    function setAllowed(bytes32 node, address who, bool ok) external {
        _allowed[node][who] = ok;
    }

    function issuePolicy(IssueParams calldata, bytes32, uint64, bytes calldata) external pure returns (bytes32) {
        revert("mock");
    }

    function updateStreak(bytes32 node, uint32 streak) external {
        _policies[node].streak = streak;
    }

    function recordPayout(bytes32 node, uint256 amount) external {
        require(msg.sender == router, "only router");
        PolicyRecord storage p = _policies[node];
        p.paidOut += amount;
        p.claimsCount += 1;
        if (p.paidOut >= p.coverageLimit) p.active = false;
    }

    function getPolicy(bytes32 node) external view returns (PolicyRecord memory) {
        return _policies[node];
    }

    function isAllowed(bytes32 node, address counterparty) external view returns (bool) {
        return _allowed[node][counterparty];
    }

    function totalCoverage() external pure returns (uint256) {
        return 0;
    }
}
