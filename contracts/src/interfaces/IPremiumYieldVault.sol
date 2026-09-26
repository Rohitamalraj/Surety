// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Owner: Person A. Minimal interface PolicyRegistry and SuretyHook need against
/// PremiumYieldVault, kept separate from PremiumYieldVault.sol itself so callers don't need the v4
/// pool-related imports just to hold a reference and call these three functions.
interface IPremiumYieldVault {
    /// @notice Fraction of each premium routed here instead of the reserve, in basis points (max 5000).
    function yieldShareBps() external view returns (uint256);

    /// @dev Only PolicyRegistry, at the moment a premium is charged.
    function depositPremiumShare(uint256 amount) external;

    /// @dev Only SuretyHook, at the moment a backer deposits principal — lets this vault attribute
    /// yield proportionally to backer principal without ever touching or risking that principal itself.
    function creditBackerPrincipal(address backer, uint256 amount) external;
}
