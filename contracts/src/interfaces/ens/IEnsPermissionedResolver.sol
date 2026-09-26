// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal, hand-written interface against ENSv2's deployed `PermissionedResolver` (every
/// policy gets its own proxy instance of this — see docs/ARCHITECTURE.md#ens for why a *shared*
/// resolver would leak one agent's streak-write permission onto every other agent's). Verified at
/// `ensdomains/contracts-v2` commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`,
/// `contracts/src/resolver/PermissionedResolver.sol` + its setter interfaces.
///
/// Setters take a DNS-encoded `name` (length-prefixed labels, zero-terminated), not a `bytes32 node` —
/// the resolver computes the node internally. `PolicyRegistry._dnsEncode` builds this.
interface IEnsPermissionedResolver {
    /// @param name DNS-encoded name, e.g. `agent1.surety.eth`.
    function setText(bytes calldata name, string calldata key, string calldata value) external;

    /// @param name DNS-encoded name.
    /// @param coinType ENSIP-9/11 coin type (`60` for ETH/EVM mainnet-style addresses).
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;

    /// @notice Authorizes `account` to call exactly the one setter call encoded in `setter` — e.g.
    /// `abi.encodeCall(ITextSetter.setText, (name, "surety.streak", ""))` grants write access to only
    /// that one text key (PRD SS10.4), never any other `surety.*` field. The resolver's generic
    /// `grantRoles` is disabled in favor of this — see docs/ARCHITECTURE.md#ens.
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);

    /// @notice Batches multiple setter calls (e.g. every `surety.*` record at issuance) into one tx.
    function multicall(bytes[] calldata calls) external returns (bytes[] memory);
}
