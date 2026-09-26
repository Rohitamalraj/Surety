// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SuretyTestBase} from "./SuretyTestBase.sol";
import {WorldIdGate} from "../src/WorldIdGate.sol";

/// IDKit proof-of-human registry: one human (nullifier) ↔ one wallet, and enrollment gating.
contract WorldIdGateHumanTest is SuretyTestBase {
    uint256 internal constant NULLIFIER = 0x04e5f6aa11;

    function _enroll(address who) internal view returns (bool) {
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        return gate.verifyEnrollment(who, SUB_HASH, expiry, _enrollSig(signerPk, who, SUB_HASH, expiry));
    }

    function test_registerHuman() public {
        vm.expectEmit(address(gate));
        emit WorldIdGate.HumanVerified(policyholder, NULLIFIER);
        vm.prank(signer);
        gate.registerHuman(policyholder, NULLIFIER);

        assertTrue(gate.isVerifiedHuman(policyholder));
        assertEq(gate.humanNullifier(policyholder), NULLIFIER);
        assertEq(gate.nullifierOwner(NULLIFIER), policyholder);
    }

    function test_registerHuman_onlySigner() public {
        vm.expectRevert(WorldIdGate.NotSigner.selector);
        gate.registerHuman(policyholder, NULLIFIER);
    }

    /// Sybil attempt: the same human tries to back a second wallet.
    function test_sameHumanSecondWallet_reverts() public {
        vm.startPrank(signer);
        gate.registerHuman(policyholder, NULLIFIER);
        vm.expectRevert(abi.encodeWithSelector(WorldIdGate.NullifierUsed.selector, NULLIFIER, policyholder));
        gate.registerHuman(attacker, NULLIFIER);
        vm.stopPrank();
    }

    function test_walletCannotBeReboundToAnotherHuman() public {
        vm.startPrank(signer);
        gate.registerHuman(policyholder, NULLIFIER);
        vm.expectRevert(abi.encodeWithSelector(WorldIdGate.WalletAlreadyVerified.selector, policyholder));
        gate.registerHuman(policyholder, NULLIFIER + 1);
        vm.stopPrank();
    }

    function test_zeroNullifier_reverts() public {
        vm.prank(signer);
        vm.expectRevert(WorldIdGate.ZeroNullifier.selector);
        gate.registerHuman(policyholder, 0);
    }

    function test_enrollment_notGatedByDefault() public view {
        assertTrue(_enroll(policyholder));
    }

    function test_enrollment_requiresHumanWhenOn() public {
        vm.prank(owner);
        gate.setRequireUniqueHuman(true);
        assertFalse(_enroll(policyholder)); // alternative path: not yet proven unique

        vm.prank(signer);
        gate.registerHuman(policyholder, NULLIFIER);
        assertTrue(_enroll(policyholder)); // success path
    }

    function test_setRequireUniqueHuman_onlyOwner() public {
        vm.expectRevert();
        gate.setRequireUniqueHuman(true);
    }
}
