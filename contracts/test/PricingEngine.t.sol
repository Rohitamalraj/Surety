// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../src/PricingEngine.sol";

contract PricingEngineHarness {
    struct Q {
        uint256 premium;
        uint256 lambdaPost;
        uint256 z;
        uint256 tierLoading;
        uint256 streakDiscount;
    }

    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        external
        pure
        returns (Q memory q)
    {
        (q.premium, q.lambdaPost, q.z, q.tierLoading, q.streakDiscount) =
            PricingEngine.quote(coverage, tier, streak, claims, periods);
    }

    function lambdaAgent(uint32 claims, uint32 periods) external pure returns (uint256) {
        return PricingEngine.lambdaAgent(claims, periods);
    }

    function satisfies(uint8 tier, uint256 coverage, uint256 perTxCap, uint256 allowlistLength)
        external
        pure
        returns (bool)
    {
        return PricingEngine.satisfiesTierBounds(tier, coverage, perTxCap, allowlistLength);
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
        PricingEngineHarness.Q memory q = h.quote(COVERAGE, 1, 0, 0, 0);
        assertEq(q.z, 0);
        assertEq(q.lambdaPost, 0.05e18);
        assertEq(q.tierLoading, 1.25e18);
        assertEq(q.streakDiscount, 0);
        assertEq(q.premium, 625 * USDC);
    }

    function test_cleanRecord() public view {
        PricingEngineHarness.Q memory q = h.quote(COVERAGE, 2, 20, 0, 20);
        assertApproxEqAbs(q.z, 0.666666666666666666e18, 1);
        assertEq(h.lambdaAgent(0, 20), 0);
        assertEq(q.streakDiscount, 0.2e18);
        assertApproxEqAbs(q.premium, 133_333_333, 2); // 133.33 USDC
    }

    function test_oneClaim() public view {
        PricingEngineHarness.Q memory q = h.quote(COVERAGE, 1, 5, 1, 10);
        assertEq(q.z, 0.5e18);
        assertEq(h.lambdaAgent(1, 10), 0.1e18);
        assertEq(q.lambdaPost, 0.075e18);
        assertEq(q.streakDiscount, 0.05e18);
        assertEq(q.premium, 890_625_000); // 890.625 USDC
    }

    function test_streakDiscountCapped() public view {
        assertEq(h.quote(COVERAGE, 1, 500, 0, 0).streakDiscount, 0.2e18);
    }

    function test_tierLoads() public view {
        assertEq(h.quote(COVERAGE, 0, 0, 0, 0).premium, 750 * USDC);
        assertEq(h.quote(COVERAGE, 2, 0, 0, 0).premium, 500 * USDC);
    }

    function test_invalidTierReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.InvalidTier.selector, uint8(3)));
        h.quote(COVERAGE, 3, 0, 0, 0);
    }

    function test_tierBounds() public view {
        assertTrue(h.satisfies(2, COVERAGE, 500 * USDC, 1)); // 5% cap + allowlist
        assertFalse(h.satisfies(2, COVERAGE, 500 * USDC, 0)); // no allowlist
        assertFalse(h.satisfies(2, COVERAGE, 501 * USDC, 1));
        assertTrue(h.satisfies(1, COVERAGE, 2_000 * USDC, 0)); // 20%
        assertFalse(h.satisfies(1, COVERAGE, 2_001 * USDC, 0));
        assertTrue(h.satisfies(0, COVERAGE, COVERAGE, 0));
    }

    function test_maxTier() public view {
        assertEq(h.maxTier(COVERAGE, 500 * USDC, 1), 2);
        assertEq(h.maxTier(COVERAGE, 500 * USDC, 0), 1);
        assertEq(h.maxTier(COVERAGE, 2_000 * USDC, 3), 1);
        assertEq(h.maxTier(COVERAGE, 2_001 * USDC, 3), 0);
    }

    function testFuzz_premiumNeverExceedsCoverageTimesMaxLoad(uint64 coverage, uint32 streak, uint32 claims, uint32 n)
        public
        view
    {
        vm.assume(claims <= n);
        PricingEngineHarness.Q memory q = h.quote(coverage, 0, streak, claims, n);
        assertLe(q.premium, uint256(coverage) * 3 / 2);
    }
}
