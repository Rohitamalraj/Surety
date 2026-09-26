// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Grant} from "./IEnsResolverInitializable.sol";

/// @notice Minimal interface for initializing a freshly-deployed `UserRegistry` proxy — ENSv2's
/// UUPS-upgradeable `PermissionedRegistry` meant to be deployed per-user via `VerifiableFactory`
/// (Sepolia impl: `0xa80338aaa8d23831cea25e858d1774534abb0263`), used here as `surety.eth`'s own
/// subregistry so agent subnames can be minted under it. Verified at `ensdomains/contracts-v2` commit
/// `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`, `contracts/src/registry/UserRegistry.sol`.
interface IEnsUserRegistryInitializable {
    /// @param grants Root-resource roles to grant on initialization (at least one, non-zero, or the
    /// real contract reverts `InvalidOwner`) — e.g. `EnsRoles.ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN` for
    /// whichever account should be able to mint (and later delegate minting rights for) subnames.
    function initialize(Grant[] calldata grants) external;
}
