// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../src/PricingEngine.sol";

contract PricingEngineHarness {
    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        external
        pure
        returns (PricingEngine.Quote memory)
    {
        return PricingEngine.quote(coverage, tier, streak, claims, periods);
    }

    function maxTier(uint256 coverage, uint256 perTxCap, uint256 allowlistLength) external pure returns (uint8) {
        return PricingEngine.maxTier(coverage, perTxCap, allowlistLength);
    }
}

/// @dev Fixtures are PRD §14.1 — the frontend's usePricing must produce the same numbers.
contract PricingEngineTest is Test {
    uint256 constant USDC = 1e6;
    uint256 constant COVERAGE = 10_000 * USDC;
    PricingEngineHarness h;

    function setUp() public {
        h = new PricingEngineHarness();
    }

    function test_newAgent() public view {
        PricingEngine.Quote memory q = h.quote(COVERAGE, 1, 0, 0, 0);
        assertEq(q.z, 0);
        assertEq(q.lambdaPost, 0.05e18);
        assertEq(q.tierLoad, 1.25e18);
        assertEq(q.streakDisc, 0);
        assertEq(q.premium, 625 * USDC);
    }

    function test_cleanRecord() public view {
        PricingEngine.Quote memory q = h.quote(COVERAGE, 2, 20, 0, 20);
        assertApproxEqAbs(q.z, 0.666666666666666666e18, 1);
        assertEq(q.lambdaAgent, 0);
        assertEq(q.streakDisc, 0.2e18);
        assertApproxEqAbs(q.premium, 133_333_333, 2); // 133.33 USDC
    }

    function test_oneClaim() public view {
        PricingEngine.Quote memory q = h.quote(COVERAGE, 1, 5, 1, 10);
        assertEq(q.z, 0.5e18);
        assertEq(q.lambdaAgent, 0.1e18);
        assertEq(q.lambdaPost, 0.075e18);
        assertEq(q.streakDisc, 0.05e18);
        assertEq(q.premium, 890_625_000); // 890.625 USDC
    }

    function test_streakDiscountCapped() public view {
        assertEq(h.quote(COVERAGE, 1, 500, 0, 0).streakDisc, 0.2e18);
    }

    function test_tierLoads() public view {
        assertEq(h.quote(COVERAGE, 0, 0, 0, 0).premium, 750 * USDC);
        assertEq(h.quote(COVERAGE, 2, 0, 0, 0).premium, 500 * USDC);
    }

    function test_invalidTierReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.InvalidTier.selector, uint8(3)));
        h.quote(COVERAGE, 3, 0, 0, 0);
    }

    function test_maxTier() public view {
        assertEq(h.maxTier(COVERAGE, 500 * USDC, 1), 2); // 5% cap + allowlist
        assertEq(h.maxTier(COVERAGE, 500 * USDC, 0), 1); // no allowlist
        assertEq(h.maxTier(COVERAGE, 2_000 * USDC, 3), 1); // 20%
        assertEq(h.maxTier(COVERAGE, 2_001 * USDC, 3), 0);
    }

    function testFuzz_premiumNeverExceedsCoverageTimesMaxLoad(uint64 coverage, uint32 streak, uint32 claims, uint32 n)
        public
        view
    {
        vm.assume(claims <= n);
        PricingEngine.Quote memory q = h.quote(coverage, 0, streak, claims, n);
        assertLe(q.premium, uint256(coverage) * 3 / 2);
    }
}
