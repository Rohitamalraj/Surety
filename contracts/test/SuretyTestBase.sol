// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorldIdGate} from "../src/WorldIdGate.sol";
import {ViolationOracle} from "../src/ViolationOracle.sol";
import {ClaimRouter} from "../src/ClaimRouter.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {IWorldIdGate} from "../src/interfaces/IWorldIdGate.sol";
import {ISuretyHook} from "../src/interfaces/ISuretyHook.sol";
import {IViolationOracle} from "../src/interfaces/IViolationOracle.sol";
import {PolicyRecord} from "../src/interfaces/SuretyTypes.sol";
import {TrustMockRegistry} from "./mocks/TrustMockRegistry.sol";
import {TrustMockVault} from "./mocks/TrustMockVault.sol";
import {TrustMockHook} from "./mocks/TrustMockHook.sol";

/// @dev Wires Person B's real contracts against mocks of Person A's.
abstract contract SuretyTestBase is Test {
    uint256 internal constant USDC = 1e6;

    uint256 internal signerPk = 0xB0B;
    address internal signer;
    address internal owner = makeAddr("owner");
    address internal policyholder = makeAddr("policyholder");
    address internal agent = makeAddr("agent");
    address internal payoutAddr = makeAddr("payout");
    address internal merchant = makeAddr("merchant"); // on allowlist
    address internal attacker = makeAddr("attacker"); // off allowlist

    bytes32 internal constant NODE = keccak256("agent1.surety.eth");
    bytes32 internal constant SUB_HASH = keccak256("pairwise-sub-of-policyholder");

    TrustMockRegistry internal registry;
    TrustMockVault internal vault;
    TrustMockHook internal hook;
    WorldIdGate internal gate;
    ViolationOracle internal oracle;
    ClaimRouter internal router;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        signer = vm.addr(signerPk);

        registry = new TrustMockRegistry();
        vault = new TrustMockVault();
        hook = new TrustMockHook();
        gate = new WorldIdGate(signer, owner);
        oracle = new ViolationOracle(IAgentVault(address(vault)), IPolicyRegistry(address(registry)), owner);
        router = new ClaimRouter(
            IPolicyRegistry(address(registry)),
            IAgentVault(address(vault)),
            IViolationOracle(address(oracle)),
            IWorldIdGate(address(gate)),
            ISuretyHook(address(hook)),
            signer,
            owner
        );
        registry.setRouter(address(router));
        hook.setRouter(address(router));
        vm.prank(owner);
        gate.setWiring(router, IPolicyRegistry(address(registry)));

        registry.setPolicy(
            NODE,
            PolicyRecord({
                policyholder: policyholder,
                agent: agent,
                payoutAddr: payoutAddr,
                coverageLimit: 10_000 * USDC,
                perTxCap: 500 * USDC,
                tier: 1,
                streak: 0,
                claimsCount: 0,
                subHash: SUB_HASH,
                paidOut: 0,
                issuedAt: uint64(block.timestamp),
                active: true
            })
        );
        registry.setAllowed(NODE, merchant, true);
        hook.depositBacking(50_000 * USDC);
    }

    // ---------------------------------------------------------------- signing helpers

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", gate.domainSeparator(), structHash));
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(structHash));
        return abi.encodePacked(r, s, v);
    }

    function _enrollSig(uint256 pk, address who, bytes32 subHash, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, keccak256(abi.encode(gate.ENROLLMENT_TYPEHASH(), who, subHash, expiry)));
    }

    function _approvalSig(uint256 pk, uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, keccak256(abi.encode(gate.CLAIM_APPROVAL_TYPEHASH(), claimId, subHash, authTime, expiry)));
    }

    /// @dev Agent makes an over-cap payment to an allowed merchant; policyholder files a claim.
    function _fileCapBreachClaim(uint256 amount) internal returns (uint256 claimId, uint256 paymentId) {
        paymentId = vault.record(NODE, merchant, amount);
        vm.prank(policyholder);
        claimId = router.fileClaim(NODE, paymentId);
    }
}
