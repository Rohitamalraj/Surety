// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

/// @dev Minimal interfaces against ENSv2's deployed Sepolia contracts (shapes verified by Person A at
/// ensdomains/contracts-v2 @ 71a3b73; kept local so this script doesn't depend on a/chain's files).
struct Grant {
    address account;
    uint256 roleBitmap;
}

interface IEthRegistrar {
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

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address proxy);
}

interface IUserRegistryInit {
    function initialize(Grant[] calldata grants) external;
}

interface IMintableToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title RegisterParent
/// @notice Registers the policy namespace parent (default `surety.eth`) on the real ENSv2 Sepolia beta,
/// with its own UserRegistry as the subregistry, so PolicyRegistry can issue `<agent>.surety.eth` names.
/// ENS requires commit → wait ≥ 60 s → register, so this runs in two stages:
///
///   STAGE=commit   forge script script/RegisterParent.s.sol --rpc-url sepolia --broadcast
///   (wait 70 seconds)
///   STAGE=register forge script script/RegisterParent.s.sol --rpc-url sepolia --broadcast
///
/// Writes ../deployments/sepolia.ens.json { label, userRegistry, commitment } — ENS_PARENT_REGISTRY for
/// Person A's Deploy.s.sol is `userRegistry`. The fee is paid in ENS's own Sepolia test USDC, which is
/// publicly mintable. Env: DEPLOYER_PK, optional ENS_PARENT_LABEL (default "surety").
contract RegisterParent is Script {
    address constant ETH_REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address constant VERIFIABLE_FACTORY = 0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C;
    address constant USER_REGISTRY_IMPL = 0xA80338aAA8D23831cEa25E858D1774534aBb0263;
    address constant ENS_TEST_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;

    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128;
    uint64 constant DURATION = 365 days;
    string constant FILE = "../deployments/sepolia.ens.json";

    error NameTaken(string label);
    error CommitmentTooYoung(uint64 committedAt, uint256 now_);

    function run() external {
        bytes32 stage = keccak256(bytes(vm.envString("STAGE")));
        if (stage == keccak256("commit")) commitStage();
        else if (stage == keccak256("register")) registerStage();
        else revert("STAGE must be commit or register");
    }

    function _label() internal view returns (string memory) {
        return vm.envOr("ENS_PARENT_LABEL", string("surety"));
    }

    /// @dev Derived from the deployer key, so it's private and both stages recompute it identically.
    function _secret(uint256 pk, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encode("surety.parent.secret", pk, label));
    }

    function commitStage() public {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(pk);
        string memory label = _label();
        IEthRegistrar registrar = IEthRegistrar(ETH_REGISTRAR);
        if (!registrar.isAvailable(label)) revert NameTaken(label);

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: owner, roleBitmap: ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN});
        bytes memory init = abi.encodeCall(IUserRegistryInit.initialize, (grants));
        uint256 salt = uint256(keccak256(abi.encode("surety.parent.registry", owner, label)));

        vm.startBroadcast(pk);
        address userRegistry = IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(USER_REGISTRY_IMPL, salt, init);
        bytes32 commitment =
            registrar.makeCommitment(label, owner, _secret(pk, label), userRegistry, address(0), DURATION, bytes32(0));
        registrar.commit(commitment);
        vm.stopBroadcast();

        string memory o = "ens";
        vm.serializeString(o, "label", label);
        vm.serializeBytes32(o, "commitment", commitment);
        vm.writeJson(vm.serializeAddress(o, "userRegistry", userRegistry), FILE);
        console2.log("UserRegistry (ENS_PARENT_REGISTRY):", userRegistry);
        console2.log("Committed. Wait 70 seconds, then run STAGE=register.");
    }

    function registerStage() public {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(pk);
        string memory label = _label();
        string memory json = vm.readFile(FILE);
        address userRegistry = vm.parseJsonAddress(json, ".userRegistry");
        bytes32 commitment = vm.parseJsonBytes32(json, ".commitment");

        uint64 committedAt = IEthRegistrar(ETH_REGISTRAR).commitmentAt(commitment);
        if (committedAt == 0 || block.timestamp < committedAt + 60) revert CommitmentTooYoung(committedAt, block.timestamp);

        vm.startBroadcast(pk);
        _payFee(owner, label);
        _register(pk, owner, label, userRegistry);
        vm.stopBroadcast();

        console2.log(string.concat(label, ".eth registered to"), owner);
        console2.log("ENS_PARENT_REGISTRY=", userRegistry);
    }

    /// @dev Mints ENS's public Sepolia test USDC for the fee (if needed) and approves the registrar.
    function _payFee(address owner, string memory label) internal {
        (uint256 base, uint256 premium) = IEthRegistrar(ETH_REGISTRAR).getRegisterPrice(label, DURATION, ENS_TEST_USDC);
        IMintableToken token = IMintableToken(ENS_TEST_USDC);
        if (token.balanceOf(owner) < base + premium) token.mint(owner, base + premium);
        token.approve(ETH_REGISTRAR, base + premium);
    }

    function _register(uint256 pk, address owner, string memory label, address userRegistry) internal {
        IEthRegistrar(ETH_REGISTRAR).register(
            label, owner, _secret(pk, label), userRegistry, address(0), DURATION, ENS_TEST_USDC, bytes32(0)
        );
    }
}
