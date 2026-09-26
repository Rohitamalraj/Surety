// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface against ENSv2's `EnhancedAccessControl` (mixed into every
/// `PermissionedRegistry`/`PermissionedResolver`) — just the two functions needed to delegate a
/// ROOT_RESOURCE role after deployment. `grantRoles` (non-root) is disabled or argument-scoped
/// depending on the concrete contract (see `IEnsPermissionedResolver.grantSetterRoles`); ROOT_RESOURCE
/// grants always go through `grantRootRoles` — `grantRoles(ROOT_RESOURCE, ...)` reverts
/// `EACRootResourceNotAllowed` by design. Verified at `ensdomains/contracts-v2` commit
/// `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`, `contracts/src/access-control/EnhancedAccessControl.sol`.
interface IEnsEnhancedAccessControl {
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
}
