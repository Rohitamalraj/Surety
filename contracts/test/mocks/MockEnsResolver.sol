// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEnsPermissionedResolver} from "../../src/interfaces/ens/IEnsPermissionedResolver.sol";
import {IEnsResolverInitializable, Grant} from "../../src/interfaces/ens/IEnsResolverInitializable.sol";

/// @notice Test-only stand-in for a deployed `PermissionedResolver` proxy instance. Simplified on
/// purpose: it does not reimplement ENS's real nybble-packed EAC bitmap system (that's already-audited,
/// deployed infrastructure we don't own — see docs/ARCHITECTURE.md#ens) — it only needs to prove
/// PolicyRegistry calls it with the right arguments in the right order.
contract MockEnsResolver is IEnsPermissionedResolver, IEnsResolverInitializable {
    mapping(address => uint256) public rootRoleBitmap;
    mapping(bytes => mapping(string => string)) public textOf;
    mapping(bytes => mapping(uint256 => bytes)) public addressOf;

    struct GrantedSetter {
        bytes setter;
        address account;
    }

    GrantedSetter[] public grantedSetters;

    function initialize(Grant[] calldata grants, bytes[] calldata calls) external {
        for (uint256 i = 0; i < grants.length; i++) {
            rootRoleBitmap[grants[i].account] = grants[i].roleBitmap;
        }
        if (calls.length > 0) {
            multicall(calls);
        }
    }

    function setText(bytes calldata name, string calldata key, string calldata value) external {
        require(rootRoleBitmap[msg.sender] != 0, "MockEnsResolver: no role");
        textOf[name][key] = value;
    }

    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external {
        require(rootRoleBitmap[msg.sender] != 0, "MockEnsResolver: no role");
        addressOf[name][coinType] = addressBytes;
    }

    function grantSetterRoles(bytes calldata setter, address account) external returns (bool) {
        require(rootRoleBitmap[msg.sender] != 0, "MockEnsResolver: no role");
        grantedSetters.push(GrantedSetter({setter: setter, account: account}));
        return true;
    }

    function multicall(bytes[] calldata calls) public returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = address(this).delegatecall(calls[i]);
            require(ok, "MockEnsResolver: multicall failed");
            results[i] = ret;
        }
    }

    function grantedSettersCount() external view returns (uint256) {
        return grantedSetters.length;
    }
}
