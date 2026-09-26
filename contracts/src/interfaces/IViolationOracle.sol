// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ViolationType} from "./SuretyTypes.sol";

/// @notice Owner: Person B. PRD §15.6 / §13.
interface IViolationOracle {
    event ViolationAttested(uint256 indexed paymentId, address source);

    /// @dev Recomputes from public on-chain data: AgentVault payment + PolicyRegistry rules.
    function check(uint256 paymentId) external view returns (ViolationType);
}
