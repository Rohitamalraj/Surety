// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SuretyTestBase} from "./SuretyTestBase.sol";
import {ViolationOracle} from "../src/ViolationOracle.sol";
import {ViolationType} from "../src/interfaces/SuretyTypes.sol";

contract ViolationOracleTest is SuretyTestBase {
    function test_withinPolicy_isNone() public {
        uint256 id = vault.record(NODE, merchant, 500 * USDC); // exactly at cap, allowed counterparty
        assertEq(uint8(oracle.check(id)), uint8(ViolationType.None));
    }

    function test_overCap_isCapBreach() public {
        uint256 id = vault.record(NODE, merchant, 501 * USDC);
        assertEq(uint8(oracle.check(id)), uint8(ViolationType.CapBreach));
    }

    function test_offAllowlist_isOffAllowlist() public {
        uint256 id = vault.record(NODE, attacker, 10 * USDC);
        assertEq(uint8(oracle.check(id)), uint8(ViolationType.OffAllowlist));
    }

    function test_capBreachTakesPrecedence() public {
        uint256 id = vault.record(NODE, attacker, 9_000 * USDC);
        assertEq(uint8(oracle.check(id)), uint8(ViolationType.CapBreach));
    }

    function test_unknownPayment_isNone() public view {
        assertEq(uint8(oracle.check(42)), uint8(ViolationType.None));
    }

    function test_attested() public {
        address attesterAddr = makeAddr("intercepta");
        vm.prank(owner);
        oracle.setAttester(attesterAddr);

        uint256 id = vault.record(NODE, merchant, 10 * USDC);
        vm.prank(attesterAddr);
        oracle.attest(id);
        assertEq(uint8(oracle.check(id)), uint8(ViolationType.Attested));
    }

    function test_attest_onlyAttester() public {
        uint256 id = vault.record(NODE, merchant, 10 * USDC);
        vm.expectRevert(ViolationOracle.NotAttester.selector);
        oracle.attest(id);
    }
}
