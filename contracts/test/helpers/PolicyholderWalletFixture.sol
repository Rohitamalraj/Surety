// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";

/// @dev Test-only contract-wallet caller. Exercises the actual ERC1155 mint callback at issuance.
contract PolicyholderWalletFixture is ERC1155Holder {
    address immutable controller = msg.sender;
    bool immutable acceptsNames;

    constructor(bool acceptsNames_) {
        acceptsNames = acceptsNames_;
    }

    function buy(
        IPolicyRegistry registry,
        IERC20 token,
        IPolicyRegistry.IssueParams calldata p,
        bytes32 subHash,
        uint64 expiry,
        bytes calldata sig
    ) external returns (bytes32) {
        require(msg.sender == controller, "fixture controller only");
        require(token.approve(address(registry), type(uint256).max));
        return registry.issuePolicy(p, subHash, expiry, sig);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes memory) public view override returns (bytes4) {
        return acceptsNames ? this.onERC1155Received.selector : bytes4(0);
    }
}
