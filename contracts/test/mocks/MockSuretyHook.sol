// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISuretyHook} from "../../src/interfaces/ISuretyHook.sol";

/// @notice Test-only double for ISuretyHook, used by PolicyRegistry.t.sol so PolicyRegistry's own logic
/// can be tested without standing up a real Uniswap v4 PoolManager (see SuretyHook.t.sol for that).
contract MockSuretyHook is ISuretyHook {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    mapping(bytes32 => uint256) public premiumsDeposited;

    constructor(IERC20 _usdc) {
        usdc = _usdc;
    }

    function depositPremium(bytes32 node, uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        premiumsDeposited[node] += amount;
        emit PremiumDeposited(node, amount);
    }

    function depositBacking(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit BackingDeposited(msg.sender, amount);
    }

    function releasePayout(uint256 claimId, address to, uint256 amount) external {
        usdc.safeTransfer(to, amount);
        emit PayoutReleased(claimId, to, amount);
    }

    function liquidReserve() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
