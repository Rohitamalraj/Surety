// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal, hand-written interface against ENSv2's deployed `PermissionedRegistry` (the real
/// concrete type behind both `RootRegistry` and `ETHRegistry` on Sepolia, and behind `surety.eth`'s own
/// registry once registered). Deliberately not the full `ensdomains/contracts-v2` source tree — see
/// docs/ARCHITECTURE.md#ens for why, and where every signature below was verified.
///
/// Only the one function `PolicyRegistry` actually calls. `IStandardRegistry.register`, confirmed at
/// `ensdomains/contracts-v2` commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`,
/// `contracts/src/registry/interfaces/IStandardRegistry.sol`.
interface IEnsSubRegistry {
    /// @param label The label to register (e.g. "agent1" under "surety.eth").
    /// @param owner The address that will own the new subname's ERC-1155 token.
    /// @param registry The subname's own subregistry (address(0) if it won't have further subnames).
    /// @param resolver The subname's resolver — a fresh per-policy `PermissionedResolver` proxy.
    /// @param roleBitmap Roles granted to `owner` over this one name. Omitting
    /// `EnsRoles.ROLE_CAN_TRANSFER_ADMIN` is what makes the subname non-transferable (PRD SS10.2) — there
    /// is no separate "lock" call, it is purely a property of which roles are granted at registration.
    /// @param expiry Unix timestamp the registration expires at.
    /// @return tokenId The ERC-1155 token ID minted for this registration.
    function register(
        string calldata label,
        address owner,
        IEnsSubRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
}
