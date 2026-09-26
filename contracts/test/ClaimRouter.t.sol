// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SuretyTestBase} from "./SuretyTestBase.sol";
import {ClaimRouter} from "../src/ClaimRouter.sol";
import {IClaimRouter} from "../src/interfaces/IClaimRouter.sol";
import {WorldIdGate} from "../src/WorldIdGate.sol";
import {Claim, ClaimStatus, PolicyRecord, ViolationType} from "../src/interfaces/SuretyTypes.sol";

contract ClaimRouterTest is SuretyTestBase {
    function _approve(uint256 claimId) internal {
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry));
    }

    // ---------------------------------------------------------------- filing

    function test_fileClaim_capBreach() public {
        uint256 paymentId = vault.record(NODE, merchant, 800 * USDC);

        vm.expectEmit(address(router));
        emit IClaimRouter.ClaimFiled(1, NODE, paymentId, ViolationType.CapBreach, 800 * USDC);
        vm.prank(policyholder);
        uint256 claimId = router.fileClaim(NODE, paymentId);

        Claim memory c = router.getClaim(claimId);
        assertEq(uint8(c.status), uint8(ClaimStatus.Pending));
        assertEq(c.amount, 800 * USDC);
        assertTrue(router.paymentClaimed(paymentId));
    }

    function test_fileClaim_onlyPolicyholder() public {
        uint256 paymentId = vault.record(NODE, merchant, 800 * USDC);
        vm.prank(agent); // a compromised agent cannot file on its own violation
        vm.expectRevert(ClaimRouter.NotPolicyholder.selector);
        router.fileClaim(NODE, paymentId);
    }

    function test_fileClaim_noViolationReverts() public {
        uint256 paymentId = vault.record(NODE, merchant, 100 * USDC);
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSelector(ClaimRouter.NoViolation.selector, paymentId));
        router.fileClaim(NODE, paymentId);
    }

    function test_fileClaim_doubleClaimReverts() public {
        (, uint256 paymentId) = _fileCapBreachClaim(800 * USDC);
        vm.prank(policyholder);
        vm.expectRevert(abi.encodeWithSelector(ClaimRouter.PaymentAlreadyClaimed.selector, paymentId));
        router.fileClaim(NODE, paymentId);
    }

    function test_fileClaim_paymentFromOtherPolicyReverts() public {
        uint256 paymentId = vault.record(keccak256("other.surety.eth"), merchant, 800 * USDC);
        vm.prank(policyholder);
        vm.expectRevert(ClaimRouter.PaymentNodeMismatch.selector);
        router.fileClaim(NODE, paymentId);
    }

    function test_fileClaim_cappedAtRemainingCoverage() public {
        (uint256 claimId,) = _fileCapBreachClaim(25_000 * USDC);
        assertEq(router.getClaim(claimId).amount, 10_000 * USDC);
    }

    // ---------------------------------------------------------------- held path

    function test_markHeld_onlyBackend() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        vm.expectRevert(ClaimRouter.NotBackend.selector);
        router.markHeld(claimId, "cancelled");
    }

    function test_heldThenVerifiedThenPaid() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);

        // World ID cancelled -> held, nothing paid
        vm.prank(signer);
        router.markHeld(claimId, "cancelled");
        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Held));
        vm.expectRevert(abi.encodeWithSelector(ClaimRouter.NotApproved.selector, claimId));
        router.execute(claimId);
        assertEq(hook.paid(payoutAddr), 0);

        // Retry succeeds
        vm.warp(block.timestamp + 60);
        _approve(claimId);
        router.execute(claimId);
        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Paid));
        assertEq(hook.paid(payoutAddr), 800 * USDC);
    }

    // ---------------------------------------------------------------- payout

    function test_execute_paysFromReserveAndRecords() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        _approve(claimId);

        vm.expectEmit(address(router));
        emit IClaimRouter.ClaimPaid(claimId, payoutAddr, 800 * USDC);
        router.execute(claimId);

        assertEq(hook.paid(payoutAddr), 800 * USDC);
        assertEq(hook.reserve(), 50_000 * USDC - 800 * USDC);
        PolicyRecord memory p = registry.getPolicy(NODE);
        assertEq(p.paidOut, 800 * USDC);
        assertEq(p.claimsCount, 1);
    }

    function test_executeWithApproval_oneTx() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        router.executeWithApproval(
            claimId, SUB_HASH, authTime, expiry, _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry)
        );
        assertEq(hook.paid(payoutAddr), 800 * USDC);
    }

    function test_execute_withoutApprovalReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        vm.expectRevert(abi.encodeWithSelector(ClaimRouter.NotApproved.selector, claimId));
        router.execute(claimId);
    }

    function test_execute_twiceReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        _approve(claimId);
        router.execute(claimId);
        vm.expectRevert(abi.encodeWithSelector(ClaimRouter.ClaimNotOpen.selector, claimId));
        router.execute(claimId);
    }

    /// Approval can't be re-used after payout either.
    function test_approvalAfterPaidReverts() public {
        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        _approve(claimId);
        router.execute(claimId);
        uint64 authTime = uint64(block.timestamp);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _approvalSig(signerPk, claimId, SUB_HASH, authTime, expiry);
        vm.expectRevert(abi.encodeWithSelector(WorldIdGate.AlreadyApproved.selector, claimId));
        gate.approveClaim(claimId, SUB_HASH, authTime, expiry, sig);
    }

    // ---------------------------------------------------------------- anti-self-dealing (invariant 3)

    function test_selfDealing_payoutIsCounterparty_rejected() public {
        // The policyholder's own payout wallet is on the allowlist and the agent overpays it.
        registry.setAllowed(NODE, payoutAddr, true);
        uint256 paymentId = vault.record(NODE, payoutAddr, 800 * USDC);
        vm.prank(policyholder);
        uint256 claimId = router.fileClaim(NODE, paymentId);
        _approve(claimId);

        vm.expectEmit(address(router));
        emit IClaimRouter.ClaimRejected(claimId, "payout address is the violating counterparty");
        router.execute(claimId);
        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Rejected));
        assertEq(hook.paid(payoutAddr), 0);
    }

    function test_selfDealing_payoutIsAgent_rejected() public {
        PolicyRecord memory p = registry.getPolicy(NODE);
        p.payoutAddr = agent;
        registry.setPolicy(NODE, p);

        (uint256 claimId,) = _fileCapBreachClaim(800 * USDC);
        _approve(claimId);
        router.execute(claimId);
        assertEq(uint8(router.getClaim(claimId).status), uint8(ClaimStatus.Rejected));
        assertEq(hook.paid(agent), 0);
    }

    function test_coverageExhaustedBetweenFileAndExecute() public {
        (uint256 c1,) = _fileCapBreachClaim(9_000 * USDC);
        (uint256 c2,) = _fileCapBreachClaim(9_000 * USDC);
        _approve(c1);
        _approve(c2);
        router.execute(c1);
        router.execute(c2); // only 1,000 left
        assertEq(router.getClaim(c2).amount, 1_000 * USDC);
        assertEq(hook.paid(payoutAddr), 10_000 * USDC);
        assertFalse(registry.getPolicy(NODE).active);
    }

    function test_inactivePolicyCannotFile() public {
        PolicyRecord memory p = registry.getPolicy(NODE);
        p.active = false;
        registry.setPolicy(NODE, p);
        uint256 paymentId = vault.record(NODE, merchant, 800 * USDC);
        vm.prank(policyholder);
        vm.expectRevert(ClaimRouter.PolicyInactive.selector);
        router.fileClaim(NODE, paymentId);
    }
}
