// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEnsSubRegistry} from "../../src/interfaces/ens/IEnsSubRegistry.sol";

/// @notice Test-only stand-in for the "surety.eth" `PermissionedRegistry` instance PolicyRegistry
/// registers subnames against. Records every `register` call for test assertions instead of
/// reimplementing ENS's real ERC-1155 + EAC token/role machinery.
contract MockEnsSubRegistry is IEnsSubRegistry {
    struct Registration {
        string label;
        address owner;
        address registry;
        address resolver;
        uint256 roleBitmap;
        uint64 expiry;
    }

    Registration[] public registrations;
    uint256 internal _nextTokenId = 1;

    function register(
        string calldata label,
        address owner,
        IEnsSubRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId) {
        registrations.push(
            Registration({
                label: label,
                owner: owner,
                registry: address(registry),
                resolver: resolver,
                roleBitmap: roleBitmap,
                expiry: expiry
            })
        );
        tokenId = _nextTokenId++;
    }

    function registrationsCount() external view returns (uint256) {
        return registrations.length;
    }
}
