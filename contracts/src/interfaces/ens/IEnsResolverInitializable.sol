// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Mirrors `ensdomains/contracts-v2`'s `Grant` (`contracts/src/access-control/interfaces/
/// IEACGrantInitializable.sol`) — an (account, roleBitmap) pair granted at the resolver's ROOT_RESOURCE
/// when the proxy is initialized.
struct Grant {
    address account;
    uint256 roleBitmap;
}

/// @notice Minimal interface for initializing a freshly-deployed `PermissionedResolver` proxy. Verified
/// at `ensdomains/contracts-v2` commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`,
/// `contracts/src/resolver/interfaces/IPermissionedResolverInitializable.sol`.
interface IEnsResolverInitializable {
    /// @param grants Root-resource roles to grant on initialization — `PolicyRegistry` grants itself
    /// `ROLE_SET_TEXT | ROLE_SET_TEXT_ADMIN | ROLE_SET_ADDRESS | ROLE_SET_ADDRESS_ADMIN` here so it can
    /// both write every `surety.*` record directly and later delegate the one streak-only setter role
    /// to the agent's key via `grantSetterRoles` (the ADMIN bits are what make roles grantable to
    /// others — see docs/ARCHITECTURE.md#ens and `EnhancedAccessControl._getSettableRoles`).
    /// @param calls Optional calldata executed via `multicall` during initialization, bypassing the
    /// normal permission checks. `PolicyRegistry` leaves this empty and writes records afterwards.
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
}
