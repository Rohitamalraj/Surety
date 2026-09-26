// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title PricingEngine
/// @notice Credibility-weighted frequency pricing (PRD §14). All ratios are 1e18 fixed point;
/// coverage and premium are MockUSDC base units. Every intermediate term is returned so the
/// frontend can show the formula computing live. Signature locked in TEAM_PLAN §2.
///
///   Z          = n / (n + K)
///   λ_agent    = claims / max(n, 1)
///   λ_post     = Z·λ_agent + (1 − Z)·λ_PRIOR
///   premium    = coverage × λ_post × tierLoad × (1 − streakDisc)
library PricingEngine {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant K = 10; // credibility constant
    uint256 internal constant LAMBDA_PRIOR = 0.05e18; // 5% pool-wide prior frequency
    uint256 internal constant STREAK_STEP = 0.01e18; // 1% discount per clean period
    uint256 internal constant MAX_STREAK_DISC = 0.2e18; // capped at 20%

    error InvalidTier(uint8 tier);

    /// @param coverage Coverage limit, MockUSDC base units.
    /// @param tier 0 = riskiest/most expensive, 2 = tightest/cheapest (PRD §14.2).
    /// @param streak Consecutive clean periods (discount only, capped).
    /// @param claims Claims paid over the observed periods.
    /// @param periods Policy periods observed (`n`).
    /// @return premium MockUSDC base units.
    /// @return lambdaPost Credibility-weighted claim frequency, 1e18.
    /// @return z Credibility weight, 1e18 (0 → 1).
    /// @return tierLoading Tier loading factor, 1e18.
    /// @return streakDiscount Streak discount, 1e18 (≤ 0.2e18).
    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        internal
        pure
        returns (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount)
    {
        z = credibility(periods);
        lambdaPost = (z * lambdaAgent(claims, periods) + (WAD - z) * LAMBDA_PRIOR) / WAD;
        tierLoading = tierLoad(tier);
        streakDiscount = streakDisc(streak);
        premium = coverage * lambdaPost / WAD * tierLoading / WAD * (WAD - streakDiscount) / WAD;
    }

    /// @notice Z = n / (n + K).
    function credibility(uint32 periods) internal pure returns (uint256) {
        return uint256(periods) * WAD / (uint256(periods) + K);
    }

    /// @notice min(streak × 1%, 20%).
    function streakDisc(uint32 streak) internal pure returns (uint256) {
        uint256 disc = uint256(streak) * STREAK_STEP;
        return disc > MAX_STREAK_DISC ? MAX_STREAK_DISC : disc;
    }

    /// @notice λ_agent on its own, for UIs that show every term.
    function lambdaAgent(uint32 claims, uint32 periods) internal pure returns (uint256) {
        return uint256(claims) * WAD / (periods == 0 ? 1 : periods);
    }

    /// @notice Tier 0 = riskiest configuration. Tighter rules are cheaper because enforcement bounds max loss.
    function tierLoad(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 1.5e18;
        if (tier == 1) return 1.25e18;
        if (tier == 2) return 1e18;
        revert InvalidTier(tier);
    }

    /// @notice PRD §14.2 tier bounds. Tier 2: perTxCap ≤ 5% of coverage and a non-empty allowlist.
    /// Tier 1: perTxCap ≤ 20%. Tier 0: no constraint.
    function satisfiesTierBounds(uint8 tier, uint256 coverage, uint256 perTxCap, uint256 allowlistLength)
        internal
        pure
        returns (bool)
    {
        if (tier == 2) return perTxCap * 20 <= coverage && allowlistLength > 0;
        if (tier == 1) return perTxCap * 5 <= coverage;
        return true;
    }

    /// @notice Best tier a rule set qualifies for.
    function maxTier(uint256 coverage, uint256 perTxCap, uint256 allowlistLength) internal pure returns (uint8) {
        if (satisfiesTierBounds(2, coverage, perTxCap, allowlistLength)) return 2;
        if (satisfiesTierBounds(1, coverage, perTxCap, allowlistLength)) return 1;
        return 0;
    }
}
