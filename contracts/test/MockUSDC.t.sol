// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_metadata() public view {
        assertEq(usdc.name(), "Mock USD Coin");
        assertEq(usdc.symbol(), "MUSDC");
        assertEq(usdc.decimals(), 6);
    }

    function test_mintIncreasesBalanceAndSupply() public {
        usdc.mint(address(0xBEEF), 1_000e6);
        assertEq(usdc.balanceOf(address(0xBEEF)), 1_000e6);
        assertEq(usdc.totalSupply(), 1_000e6);
    }

    function test_mintIsPermissionless() public {
        vm.prank(address(0xC0FFEE));
        usdc.mint(address(0xC0FFEE), 500e6);
        assertEq(usdc.balanceOf(address(0xC0FFEE)), 500e6);
    }

    function test_standardERC20TransferAndApprove() public {
        usdc.mint(address(this), 100e6);
        usdc.approve(address(0xBEEF), 40e6);
        assertEq(usdc.allowance(address(this), address(0xBEEF)), 40e6);

        vm.prank(address(0xBEEF));
        usdc.transferFrom(address(this), address(0xCAFE), 40e6);
        assertEq(usdc.balanceOf(address(0xCAFE)), 40e6);
        assertEq(usdc.balanceOf(address(this)), 60e6);
    }
}
