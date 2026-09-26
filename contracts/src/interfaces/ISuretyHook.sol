// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ViolationType} from "./SuretyTypes.sol";

/// @notice Owner: Person A (Uniswap). PRD §15.5. `beforeSwap` comes from the v4 IHooks interface.
interface ISuretyHook {
    event PremiumDeposited(bytes32 indexed node, uint256 amount);
    event BackingDeposited(address indexed backer, uint256 amount);
    event PayoutReleased(uint256 indexed claimId, address to, uint256 amount);
    event EnforceSet(bool on);

    error PolicyViolation(bytes32 node, ViolationType reason);

    /// @dev Only PolicyRegistry.
    function depositPremium(bytes32 node, uint256 amount) external;

    function depositBacking(uint256 amount) external;

    /// @dev Only ClaimRouter. Pays from the liquid reserve only — never from an LP position.
    function releasePayout(uint256 claimId, address to, uint256 amount) external;

    function liquidReserve() external view returns (uint256);
}
