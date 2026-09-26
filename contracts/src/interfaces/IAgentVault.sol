// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Payment} from "./SuretyTypes.sol";

/// @notice Owner: Person A. PRD §15.4.
/// `swap(...)` is defined on the concrete contract (needs v4 PoolKey types) and is not part of this interface.
interface IAgentVault {
    event Deposited(bytes32 indexed node, uint256 amount);
    event PaymentMade(bytes32 indexed node, uint256 indexed paymentId, address to, uint256 amount);

    function deposit(bytes32 node, uint256 amount) external;

    /// @dev Only the policy's agent. Records every transfer and does NOT block on a rule breach —
    /// a recorded breach is the insured event.
    function pay(bytes32 node, address to, uint256 amount) external returns (uint256 paymentId);

    function withdraw(bytes32 node, uint256 amount) external;
    function getPayment(uint256 paymentId) external view returns (Payment memory);
    function balanceOf(bytes32 node) external view returns (uint256);
}
