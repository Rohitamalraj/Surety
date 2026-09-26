// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title PricingEngine
/// @notice Credibility-weighted frequency pricing (PRD §14). All ratios are 1e18 fixed point;
/// coverage and premium are MockUSDC base units. Every intermediate term is returned so the
/// frontend can show the formula computing live.
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

    struct Quote {
        uint256 premium;
        uint256 z;
        uint256 lambdaAgent;
        uint256 lambdaPost;
        uint256 tierLoad;
        uint256 streakDisc;
    }

    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        internal
        pure
        returns (Quote memory q)
    {
        uint256 n = periods;
        q.z = n * WAD / (n + K);
        q.lambdaAgent = uint256(claims) * WAD / (n == 0 ? 1 : n);
        q.lambdaPost = (q.z * q.lambdaAgent + (WAD - q.z) * LAMBDA_PRIOR) / WAD;
        q.tierLoad = tierLoad(tier);
        uint256 disc = uint256(streak) * STREAK_STEP;
        q.streakDisc = disc > MAX_STREAK_DISC ? MAX_STREAK_DISC : disc;
        q.premium = coverage * q.lambdaPost / WAD * q.tierLoad / WAD * (WAD - q.streakDisc) / WAD;
    }

    /// @notice Tier 0 = riskiest configuration. Tighter rules are cheaper because enforcement bounds max loss.
    function tierLoad(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 1.5e18;
        if (tier == 1) return 1.25e18;
        if (tier == 2) return 1e18;
        revert InvalidTier(tier);
    }

    /// @notice Best tier a rule set qualifies for (PRD §14.2).
    /// Tier 2: perTxCap ≤ 5% of coverage and a non-empty allowlist. Tier 1: perTxCap ≤ 20%. Else tier 0.
    function maxTier(uint256 coverage, uint256 perTxCap, uint256 allowlistLength) internal pure returns (uint8) {
        if (allowlistLength > 0 && perTxCap * 20 <= coverage) return 2;
        if (perTxCap * 5 <= coverage) return 1;
        return 0;
    }
}
