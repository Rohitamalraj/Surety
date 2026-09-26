// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice ENSIP-10 read entry point implemented by ENSv2 AbstractRecordResolver.
/// Verified against contracts-v2 commit 71a3b7339dbc55ab47667abdfe8303bac4f4c24e.
interface IEnsExtendedResolver {
    /// @param name DNS-wire-encoded full name. This determines the record being read.
    /// @param data ABI-encoded profile query, e.g. IEnsTextResolver.text(node, key).
    /// @return result ABI-encoded profile result; decode a text result as (string).
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory result);
}
