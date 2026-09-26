// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice PLACEHOLDER — Person B owns PricingEngine.sol (PRD §15.2, TEAM_PLAN §5). This file exists
/// only so PolicyRegistry.sol (Person A) compiles and can be tested on `a/chain` before the branches
/// merge at a sync point; it implements the PRD §14 formula and the locked signature from
/// TEAM_PLAN §2 exactly (`internal pure`, 1e18 fixed point), so at merge time it should be a drop-in
/// swap for Person B's canonical file — replace this file with theirs, don't hand-reconcile it.
///
/// premium = coverage · λ_post · tierLoad · (1 − streakDisc)
/// λ_post  = Z·λ_agent + (1 − Z)·λ_prior,  Z = n/(n+k),  λ_agent = claims/max(n,1)
library PricingEngine {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant CREDIBILITY_K = 10;
    uint256 internal constant LAMBDA_PRIOR = 0.05e18; // 5% pool-wide prior claim frequency
    uint256 internal constant STREAK_DISCOUNT_PER_UNIT = 0.01e18; // 1% per clean period
    uint256 internal constant MAX_STREAK_DISCOUNT = 0.20e18; // capped at 20%

    error InvalidTier(uint8 tier);

    /// @param coverage Coverage limit, MockUSDC base units.
    /// @param tier Pricing tier (0 = riskiest/most expensive, 2 = tightest/cheapest — PRD §14.2).
    /// @param streak Consecutive clean periods (drives the discount only, capped).
    /// @param claims Claims paid over the observed periods.
    /// @param periods Policy periods observed for this agent (`n` — PRD §14: streak + claims periods).
    /// @return premium MockUSDC base units.
    /// @return lambdaPost Credibility-weighted claim frequency, 1e18 fixed point.
    /// @return z Credibility weight, 1e18 fixed point (0 → 1).
    /// @return tierLoading Tier loading factor, 1e18 fixed point.
    /// @return streakDiscount Streak discount, 1e18 fixed point (capped at 0.20e18).
    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        internal
        pure
        returns (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount)
    {
        uint256 n = uint256(periods);
        z = (n * WAD) / (n + CREDIBILITY_K);

        uint256 nOrOne = n == 0 ? 1 : n;
        uint256 lambdaAgent = (uint256(claims) * WAD) / nOrOne;
        lambdaPost = (z * lambdaAgent + (WAD - z) * LAMBDA_PRIOR) / WAD;

        tierLoading = _tierLoad(tier);

        uint256 rawDiscount = uint256(streak) * STREAK_DISCOUNT_PER_UNIT;
        streakDiscount = rawDiscount > MAX_STREAK_DISCOUNT ? MAX_STREAK_DISCOUNT : rawDiscount;

        premium = coverage * lambdaPost / WAD;
        premium = premium * tierLoading / WAD;
        premium = premium * (WAD - streakDiscount) / WAD;
    }

    /// @dev tier 0 = 1.50x (riskiest config, no cap/allowlist tightness required), 1 = 1.25x, 2 = 1.00x.
    function _tierLoad(uint8 tier) private pure returns (uint256) {
        if (tier == 0) return 1.50e18;
        if (tier == 1) return 1.25e18;
        if (tier == 2) return 1.00e18;
        revert InvalidTier(tier);
    }

    /// @dev PRD §14.2 tier bounds: tier 2 needs perTxCap <= 5% of coverage and a non-empty allowlist;
    /// tier 1 needs perTxCap <= 20%; tier 0 has no additional constraint.
    function satisfiesTierBounds(uint8 tier, uint256 coverage, uint256 perTxCap, uint256 allowlistLength)
        internal
        pure
        returns (bool)
    {
        if (tier == 2) {
            return perTxCap * 100 <= coverage * 5 && allowlistLength > 0;
        }
        if (tier == 1) {
            return perTxCap * 100 <= coverage * 20;
        }
        return true;
    }
}
