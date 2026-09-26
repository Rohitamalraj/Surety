// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice ENSIP-5 query encoding only for ENSv2 PermissionedResolver.
/// That resolver does NOT expose this function directly. Pass abi.encodeCall(text, (node, key))
/// to IEnsExtendedResolver.resolve(dnsName, data), then decode its result as (string).
/// Application clients should discover the current resolver through the Universal Resolver.
interface IEnsTextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}
