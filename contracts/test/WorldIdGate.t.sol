// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SuretyTestBase} from "./SuretyTestBase.sol";
import {WorldIdGate} from "../src/WorldIdGate.sol";
import {IWorldIdGate} from "../src/interfaces/IWorldIdGate.sol";

contract WorldIdGateTest is SuretyTestBase {
    uint256 internal constant ATTACKER_PK = 0xBAD;

    // ---------------------------------------------------------------- enrollment

    function test_enrollment_valid() public view {
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _enrollSig(signerPk, policyholder, SUB_HASH, expiry);
        assertTrue(gate.verifyEnrollment(policyholder, SUB_HASH, expiry, sig));
    }

    function test_enrollment_wrongSigner() public view {
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _enrollSig(ATTACKER_PK, policyholder, SUB_HASH, expiry);
        assertFalse(gate.verifyEnrollment(policyholder, SUB_HASH, expiry, sig));
    }

    function test_enrollment_boundToPolicyholder() public view {
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _enrollSig(signerPk, policyholder, SUB_HASH, expiry);
        assertFalse(gate.verifyEnrollment(attacker, SUB_HASH, expiry, sig));
    }

    function test_enrollment_expired() public {
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _enrollSig(signerPk, policyholder, SUB_HASH, expiry);
        vm.warp(expiry + 1);
        assertFalse(gate.verifyEnrollment(policyholder, SUB_HASH, expiry, sig));
    }

    function test_enrollment_garbageSigReturnsFalse() public view {
        assertFalse(gate.verifyEnrollment(policyholder, SUB_HASH, uint64(block.timestamp + 1), hex"1234"));
    }

    // ---------------------------------------------------------------- claim approval

    function test_approve_valid() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        vm.warp(block.timestamp + 30);
        uint64 authTime = uint64(block.timestamp - 5);
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        vm.expectEmit(address(gate));
        emit IWorldIdGate.ClaimApproved(claimId, authTime);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry));
        assertTrue(gate.isApproved(claimId));
    }

    function test_approve_replayReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);

        vm.expectRevert(abi.encodeWithSelector(WorldIdGate.AlreadyApproved.selector, claimId));
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);
    }

    function test_approve_sigForOtherClaimReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sigForClaim2 = _approvalSig(signerPk, claimId + 1, SUB_HASH, authTime, expiry);

        vm.expectRevert(WorldIdGate.InvalidSignature.selector);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sigForClaim2);
    }

    function test_approve_wrongSignerReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        bytes memory sig = _approvalSig(ATTACKER_PK, claimId, SUB_HASH, authTime, expiry);
        vm.expectRevert(WorldIdGate.InvalidSignature.selector);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);
    }

    function test_approve_expiredReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 1 minutes);
        bytes memory sig = _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry);
        vm.warp(expiry + 1);

        vm.expectRevert(WorldIdGate.Expired.selector);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);
    }

    /// A different human (different pairwise sub) cannot approve this policy's claim.
    function test_approve_subjectMismatchReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        bytes32 otherSub = keccak256("someone-else");
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        bytes memory sig = _approvalSig(signerPk, claimId, otherSub, authTime, expiry);
        vm.expectRevert(WorldIdGate.SubjectMismatch.selector);
        gate.approveClaim(claimId, otherSub, authTime, expiry, sig);
    }

    /// World ID authentication that happened before the claim existed is not "fresh for this claim".
    function test_approve_authBeforeClaimReverts() public {
        uint64 oldAuth = uint64(block.timestamp);
        vm.warp(block.timestamp + 1 hours);
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        bytes memory sig = _approvalSig(signerPk, claimId, SUB_HASH, oldAuth, expiry);
        vm.expectRevert(WorldIdGate.StaleAuthentication.selector);
        gate.approveClaim(claimId, SUB_HASH, oldAuth, expiry, sig);
    }

    function test_approve_authTooOldReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry);
        vm.warp(block.timestamp + 11 minutes);

        vm.expectRevert(WorldIdGate.StaleAuthentication.selector);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);
    }

    function test_approve_unknownClaimReverts() public {
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);

        bytes memory sig = _approvalSig(signerPk, 99, SUB_HASH, authTime, expiry);
        vm.expectRevert(abi.encodeWithSelector(WorldIdGate.ClaimNotOpen.selector, 99));
        gate.approveClaim(99, SUB_HASH, authTime, expiry, sig);
    }

    // ---------------------------------------------------------------- admin

    function test_setSigner_onlyOwner() public {
        vm.expectRevert();
        gate.setSigner(attacker);

        vm.prank(owner);
        gate.setSigner(attacker);
        assertEq(gate.signer(), attacker);
    }
}
