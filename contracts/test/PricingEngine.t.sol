// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../src/PricingEngine.sol";

/// @notice Cross-checks the placeholder PricingEngine against the three worked examples in PRD §14.1
/// (coverage = 10,000 USDC throughout). Tolerances allow for the PRD table itself only showing premiums
/// rounded to 2 decimal places — the underlying fraction (e.g. 133.333...) is the real target.
contract PricingEngineTest is Test {
    uint256 constant COVERAGE = 10_000e6;
    uint256 constant WAD = 1e18;

    function test_newAgent_tier1() public pure {
        (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount) =
            PricingEngine.quote(COVERAGE, 1, 0, 0, 0);

        assertEq(z, 0);
        assertEq(lambdaPost, 0.05e18); // pure prior, no credibility yet
        assertEq(tierLoading, 1.25e18);
        assertEq(streakDiscount, 0);
        assertEq(premium, 625e6); // exact: 10000 * 0.05 * 1.25 * 1
    }

    function test_cleanRecord_tier2() public pure {
        (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount) =
            PricingEngine.quote(COVERAGE, 2, 20, 0, 20);

        assertApproxEqAbs(z, 0.6667e18, 0.001e18);
        assertApproxEqAbs(lambdaPost, 0.0167e18, 0.0005e18);
        assertEq(tierLoading, 1.00e18);
        assertEq(streakDiscount, 0.20e18); // capped at 20 periods * 1%
        assertApproxEqAbs(premium, 133_330_000, 5_000); // PRD: 133.33 USDC
    }

    function test_oneClaim_tier1() public pure {
        (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount) =
            PricingEngine.quote(COVERAGE, 1, 5, 1, 10);

        assertEq(z, 0.5e18);
        assertEq(lambdaPost, 0.075e18); // exact: 0.5*0.10 + 0.5*0.05
        assertEq(tierLoading, 1.25e18);
        assertEq(streakDiscount, 0.05e18);
        assertEq(premium, 890_625_000); // exact: 10000 * 0.075 * 1.25 * 0.95
    }

    function test_streakDiscountCapsAt20Percent() public pure {
        (,,,, uint256 streakDiscount) = PricingEngine.quote(COVERAGE, 2, 100, 0, 100);
        assertEq(streakDiscount, 0.20e18);
    }

    function test_invalidTierReverts() public {
        // vm.expectRevert requires a real external call frame — PricingEngine.quote is an inlined
        // internal library call, so route it through this external wrapper.
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.InvalidTier.selector, 3));
        this.quoteExternal(COVERAGE, 3, 0, 0, 0);
    }

    function quoteExternal(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        external
        pure
        returns (uint256, uint256, uint256, uint256, uint256)
    {
        return PricingEngine.quote(coverage, tier, streak, claims, periods);
    }

    function test_tierBounds() public pure {
        // tier 2: perTxCap <= 5% of coverage AND non-empty allowlist
        assertTrue(PricingEngine.satisfiesTierBounds(2, COVERAGE, 500e6, 1));
        assertFalse(PricingEngine.satisfiesTierBounds(2, COVERAGE, 500e6, 0)); // empty allowlist
        assertFalse(PricingEngine.satisfiesTierBounds(2, COVERAGE, 501e6, 1)); // over 5%

        // tier 1: perTxCap <= 20% of coverage
        assertTrue(PricingEngine.satisfiesTierBounds(1, COVERAGE, 2_000e6, 0));
        assertFalse(PricingEngine.satisfiesTierBounds(1, COVERAGE, 2_001e6, 0));

        // tier 0: unconstrained
        assertTrue(PricingEngine.satisfiesTierBounds(0, COVERAGE, COVERAGE, 0));
    }
}
