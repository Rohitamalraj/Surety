// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Read subset of ENSv2 IRegistry at commit 71a3b7339dbc55ab47667abdfe8303bac4f4c24e.
interface IEnsRegistryReader {
    function getResolver(string calldata label) external view returns (address);
}
