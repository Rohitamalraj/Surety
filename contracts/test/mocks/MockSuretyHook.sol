// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISuretyHook} from "../../src/interfaces/ISuretyHook.sol";

/// @dev Test stand-in for Person A's SuretyHook: tracks a reserve number and who got paid.
contract MockSuretyHook is ISuretyHook {
    uint256 public reserve;
    address public router;
    mapping(address => uint256) public paid;

    function setRouter(address r) external {
        router = r;
    }

    function depositPremium(bytes32 node, uint256 amount) external {
        reserve += amount;
        emit PremiumDeposited(node, amount);
    }

    function depositBacking(uint256 amount) external {
        reserve += amount;
        emit BackingDeposited(msg.sender, amount);
    }

    function releasePayout(uint256 claimId, address to, uint256 amount) external {
        require(msg.sender == router, "only router");
        require(amount <= reserve, "reserve");
        reserve -= amount;
        paid[to] += amount;
        emit PayoutReleased(claimId, to, amount);
    }

    function liquidReserve() external view returns (uint256) {
        return reserve;
    }
}
