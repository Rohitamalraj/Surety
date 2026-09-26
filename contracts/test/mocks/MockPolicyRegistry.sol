// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {PolicyRecord} from "../../src/interfaces/SuretyTypes.sol";

/// @notice Test-only double for IPolicyRegistry, used by SuretyHook.t.sol so the hook's `beforeSwap`
/// enforcement can be tested in isolation before the real PolicyRegistry.sol exists on this branch.
contract MockPolicyRegistry is IPolicyRegistry {
    mapping(bytes32 => PolicyRecord) internal _policies;
    mapping(bytes32 => mapping(address => bool)) internal _allowed;

    function setPolicy(bytes32 node, PolicyRecord calldata record) external {
        _policies[node] = record;
    }

    function setAllowed(bytes32 node, address counterparty, bool ok) external {
        _allowed[node][counterparty] = ok;
    }

    function issuePolicy(IssueParams calldata, bytes32, uint64, bytes calldata) external pure returns (bytes32) {
        revert("MockPolicyRegistry: not implemented");
    }

    function updateStreak(bytes32, uint32) external pure {
        revert("MockPolicyRegistry: not implemented");
    }

    function recordPayout(bytes32, uint256) external pure {
        revert("MockPolicyRegistry: not implemented");
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
