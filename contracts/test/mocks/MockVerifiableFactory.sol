// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifiableFactory} from "../../src/interfaces/ens/IVerifiableFactory.sol";
import {MockEnsResolver} from "./MockEnsResolver.sol";

/// @notice Test-only stand-in for `ensdomains/verifiable-factory`'s `VerifiableFactory`. Ignores
/// `implementation` and always deploys a fresh `MockEnsResolver`, then forwards `data` to it exactly as
/// the real factory forwards to a freshly-cloned proxy's own `initialize(address, bytes)`.
contract MockVerifiableFactory is IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data)
        external
        returns (address proxy)
    {
        MockEnsResolver resolver = new MockEnsResolver();
        proxy = address(resolver);
        (bool ok,) = proxy.call(data);
        require(ok, "MockVerifiableFactory: init failed");
        emit ProxyDeployed(msg.sender, proxy, salt, implementation);
    }
}
