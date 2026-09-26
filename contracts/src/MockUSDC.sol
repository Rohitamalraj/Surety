// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Owner: Person A. Testnet-only mintable USDC stand-in (6 decimals) used for premiums,
/// backing, payouts, and one side of the Uniswap v4 pool. PRD §15.2. Mint is permissionless —
/// this is a Sepolia faucet token, never deployed to mainnet.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "MUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
