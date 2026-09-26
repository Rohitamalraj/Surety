// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {Payment} from "../../src/interfaces/SuretyTypes.sol";

/// @dev Test stand-in for Person A's AgentVault: payments are injected directly.
contract MockAgentVault is IAgentVault {
    mapping(uint256 => Payment) internal _payments;
    uint256 public paymentCount;

    function record(bytes32 node, address to, uint256 amount) external returns (uint256 id) {
        id = ++paymentCount;
        _payments[id] = Payment(node, to, amount, uint64(block.timestamp));
        emit PaymentMade(node, id, to, amount);
    }

    function deposit(bytes32, uint256) external pure {}

    function pay(bytes32, address, uint256) external pure returns (uint256) {
        revert("mock");
    }

    function withdraw(bytes32, uint256) external pure {}

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    function balanceOf(bytes32) external pure returns (uint256) {
        return 0;
    }
}
