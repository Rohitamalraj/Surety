// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface against `ensdomains/verifiable-factory`'s deployed `VerifiableFactory`
/// (Sepolia: `0x9e726eb570beb6bceb495ab8cda7df517d4e841c`, see docs/ARCHITECTURE.md#ens). Deploys a
/// UUPS proxy clone at a deterministic (caller, salt) address and initializes it in one call.
/// Verified at `ensdomains/verifiable-factory` commit `c1090aec465ab30d494c96bd7d2a147b4f0b0173`,
/// `src/VerifiableFactory.sol`.
interface IVerifiableFactory {
    event ProxyDeployed(address indexed deployer, address indexed proxy, uint256 salt, address implementation);

    /// @param implementation The `PermissionedResolverImpl` address the proxy delegates to.
    /// @param salt Caller-chosen uniqueness value — `PolicyRegistry` uses `uint256(node)`, so each
    /// policy's resolver proxy address is deterministic and never collides with another policy's.
    /// @param data Passed to the proxy's own `initialize(address, bytes)`, which further delegatecalls
    /// it into the implementation — `PolicyRegistry` passes
    /// `abi.encodeCall(IEnsResolverInitializable.initialize, (grants, calls))`.
    function deployProxy(address implementation, uint256 salt, bytes calldata data)
        external
        returns (address proxy);
}
