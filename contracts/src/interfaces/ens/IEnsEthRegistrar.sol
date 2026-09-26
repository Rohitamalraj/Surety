// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface against ENSv2's deployed `ETHRegistrar` (Sepolia:
/// `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca`), the commit-reveal registrar for new `.eth` names.
/// Verified at `ensdomains/contracts-v2` commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`,
/// `contracts/src/registrar/ETHRegistrar.sol` + `interfaces/IETHRegistrar.sol`. `subregistry`/
/// `resolver`/`paymentToken` are typed `address` here rather than their real `IRegistry`/`IERC20`
/// types — ABI-identical (an interface type IS an address at the encoding level), and this way we
/// don't need to also vendor `IRegistry`.
///
/// Only used by the real-Sepolia fork test (`contracts/test/fork/`) to register a genuine test name
/// end-to-end — never broadcast to live Sepolia, since that needs a funded private key nobody in this
/// session holds; see that test file's header for exactly what "real" means here.
interface IEnsEthRegistrar {
    function commit(bytes32 commitment) external;

    function register(
        string memory label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256);

    function commitmentAt(bytes32 commitment) external view returns (uint64);

    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);

    function isAvailable(string memory label) external view returns (bool);

    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
}
