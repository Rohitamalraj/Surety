// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Role-bit constants mirrored from ENSv2's deployed `RegistryRolesLib` and
/// `PermissionedResolverLib` (verified at `ensdomains/contracts-v2` commit
/// `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`) — not redeclared there, since we only vendor minimal
/// interfaces (docs/ARCHITECTURE.md#ens), but the bit layout is fixed by the deployed contracts and
/// must match exactly for `hasRoles`/`grantSetterRoles` checks to behave as intended.
///
/// Enhanced Access Control packs 32 regular + 32 admin roles into one nybble-per-role bitmap; holding
/// the `_ADMIN` variant of a role at `ROOT_RESOURCE` is what makes that (non-admin) role *grantable* to
/// someone else at any resource — see `EnhancedAccessControl._getSettableRoles`.
library EnsRoles {
    // ---- PermissionedRegistry (registry-level roles) ----
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;

    // ---- PermissionedResolver (resolver-level roles) ----
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_ADDRESS_ADMIN = ROLE_SET_ADDRESS << 128;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;

    /// @dev ENSIP-9/11 coin type for EVM/mainnet-style `addr()` records.
    uint256 internal constant COIN_TYPE_ETH = 60;
}
