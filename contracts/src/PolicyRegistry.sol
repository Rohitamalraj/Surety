// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IWorldIdGate} from "./interfaces/IWorldIdGate.sol";
import {ISuretyHook} from "./interfaces/ISuretyHook.sol";
import {PolicyRecord} from "./interfaces/SuretyTypes.sol";
import {PricingEngine} from "./PricingEngine.sol";

import {IEnsSubRegistry} from "./interfaces/ens/IEnsSubRegistry.sol";
import {IEnsPermissionedResolver} from "./interfaces/ens/IEnsPermissionedResolver.sol";
import {IVerifiableFactory} from "./interfaces/ens/IVerifiableFactory.sol";
import {IEnsResolverInitializable, Grant} from "./interfaces/ens/IEnsResolverInitializable.sol";
import {EnsRoles} from "./interfaces/ens/EnsRoles.sol";

/// @notice Owner: Person A (ENS). PRD §15.3, §10. Issues ENSv2-backed policies: a non-transferable
/// `<label>.<parentLabel>.eth` subname whose own, freshly-deployed `PermissionedResolver` proxy
/// publishes the policy (PRD §10.3), with the agent's key granted write access to `surety.streak` only
/// (PRD §10.4). Enforcement everywhere else in the system reads the mirrored `PolicyRecord` stored here
/// for gas/reliability — the ENS records are the published source of truth, written in the same
/// transaction (PRD §10.5).
contract PolicyRegistry is IPolicyRegistry, Ownable {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    using Strings for address;

    /// @dev namehash("eth"), verified with `cast namehash eth` (Foundry) — not hand-recalled.
    bytes32 internal constant ETH_NODE = 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;

    IEnsSubRegistry public immutable ensRegistry;
    IVerifiableFactory public immutable verifiableFactory;
    address public immutable permissionedResolverImpl;
    IWorldIdGate public immutable worldIdGate;
    IERC20 public immutable usdc;

    /// @notice namehash(`<parentLabel>.eth`) — e.g. "surety.eth", or a pre-registered fallback name
    /// (TEAM_PLAN §3 fallback) if the real one isn't available on the day.
    bytes32 public immutable parentNode;
    string public parentLabel;

    /// @notice Wired post-deploy: SuretyHook and ClaimRouter are deployed after this contract per PRD
    /// §15.9's deploy order, so neither address is known at construction time.
    ISuretyHook public hook;
    address public claimRouter;

    uint256 internal _totalCoverage;
    mapping(bytes32 => PolicyRecord) internal _policies;
    mapping(bytes32 => mapping(address => bool)) internal _allowlist;

    error ZeroAddress();
    error InvalidParams();
    error TierBoundsNotMet(uint8 tier);
    error LabelAlreadyUsed(bytes32 node);
    error EnrollmentInvalid();
    error NotAgent(bytes32 node, address caller);
    error NotClaimRouter(address caller);
    error HookNotSet();

    /// @notice Not part of the locked IPolicyRegistry API — lets the indexer/frontend discover each
    /// policy's per-policy resolver proxy without re-deriving it or querying ENS.
    event PolicyResolverDeployed(bytes32 indexed node, address resolver);

    constructor(
        IEnsSubRegistry _ensRegistry,
        IVerifiableFactory _verifiableFactory,
        address _permissionedResolverImpl,
        IWorldIdGate _worldIdGate,
        IERC20 _usdc,
        string memory _parentLabel,
        address _owner
    ) Ownable(_owner) {
        if (
            address(_ensRegistry) == address(0) || address(_verifiableFactory) == address(0)
                || _permissionedResolverImpl == address(0) || address(_worldIdGate) == address(0)
                || address(_usdc) == address(0)
        ) revert ZeroAddress();

        ensRegistry = _ensRegistry;
        verifiableFactory = _verifiableFactory;
        permissionedResolverImpl = _permissionedResolverImpl;
        worldIdGate = _worldIdGate;
        usdc = _usdc;
        parentLabel = _parentLabel;
        parentNode = keccak256(abi.encodePacked(ETH_NODE, keccak256(bytes(_parentLabel))));
    }

    ////////////////////////////////////////////////////////////////////////
    // Admin wiring (post-deploy — not part of the locked IPolicyRegistry API)
    ////////////////////////////////////////////////////////////////////////

    function setHook(ISuretyHook _hook) external onlyOwner {
        if (address(_hook) == address(0)) revert ZeroAddress();
        hook = _hook;
    }

    function setClaimRouter(address _claimRouter) external onlyOwner {
        if (_claimRouter == address(0)) revert ZeroAddress();
        claimRouter = _claimRouter;
    }

    ////////////////////////////////////////////////////////////////////////
    // IPolicyRegistry
    ////////////////////////////////////////////////////////////////////////

    /// @inheritdoc IPolicyRegistry
    function issuePolicy(IssueParams calldata p, bytes32 subHash, uint64 expiry, bytes calldata enrollSig)
        external
        returns (bytes32 node)
    {
        if (address(hook) == address(0)) revert HookNotSet();
        if (p.payoutAddr == address(0) || p.agent == address(0)) revert ZeroAddress();
        if (p.perTxCap > p.coverageLimit) revert InvalidParams();
        if (!PricingEngine.satisfiesTierBounds(p.tier, p.coverageLimit, p.perTxCap, p.allowlist.length)) {
            revert TierBoundsNotMet(p.tier);
        }

        node = _computeNode(p.label);
        if (_policies[node].issuedAt != 0) revert LabelAlreadyUsed(node);
        if (!worldIdGate.verifyEnrollment(msg.sender, subHash, expiry, enrollSig)) revert EnrollmentInvalid();

        (uint256 premium,,,,) = PricingEngine.quote(p.coverageLimit, p.tier, 0, 0, 0);
        usdc.safeTransferFrom(msg.sender, address(this), premium);
        usdc.forceApprove(address(hook), premium);
        hook.depositPremium(node, premium);

        _setUpEnsRecords(node, p, premium);

        for (uint256 i = 0; i < p.allowlist.length; i++) {
            _allowlist[node][p.allowlist[i]] = true;
        }

        _policies[node] = PolicyRecord({
            policyholder: msg.sender,
            agent: p.agent,
            payoutAddr: p.payoutAddr,
            coverageLimit: p.coverageLimit,
            perTxCap: p.perTxCap,
            tier: p.tier,
            streak: 0,
            claimsCount: 0,
            subHash: subHash,
            paidOut: 0,
            issuedAt: uint64(block.timestamp),
            active: true
        });
        _totalCoverage += p.coverageLimit;

        uint256 reserve = hook.liquidReserve();
        uint256 required = 2 * _totalCoverage;
        if (reserve < required) revert InsufficientReserve(reserve, required);

        emit PolicyIssued(node, msg.sender, p.agent, p.coverageLimit, p.perTxCap, p.tier, premium);
    }

    /// @inheritdoc IPolicyRegistry
    function updateStreak(bytes32 node, uint32 streak) external {
        PolicyRecord storage policy = _policies[node];
        if (msg.sender != policy.agent) revert NotAgent(node, msg.sender);
        policy.streak = streak;
        emit StreakUpdated(node, streak);
    }

    /// @inheritdoc IPolicyRegistry
    function recordPayout(bytes32 node, uint256 amount) external {
        if (msg.sender != claimRouter) revert NotClaimRouter(msg.sender);
        PolicyRecord storage policy = _policies[node];
        policy.paidOut += amount;
        policy.claimsCount += 1;
        _totalCoverage -= amount;
        if (policy.paidOut >= policy.coverageLimit) {
            policy.active = false;
            emit PolicyExhausted(node);
        }
    }

    /// @inheritdoc IPolicyRegistry
    function getPolicy(bytes32 node) external view returns (PolicyRecord memory) {
        return _policies[node];
    }

    /// @inheritdoc IPolicyRegistry
    function isAllowed(bytes32 node, address counterparty) external view returns (bool) {
        return _allowlist[node][counterparty];
    }

    /// @inheritdoc IPolicyRegistry
    function totalCoverage() external view returns (uint256) {
        return _totalCoverage;
    }

    ////////////////////////////////////////////////////////////////////////
    // ENS integration
    ////////////////////////////////////////////////////////////////////////

    function _computeNode(string calldata label) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    /// @dev Deploys this policy's own `PermissionedResolver` proxy, writes every `surety.*` record,
    /// grants the agent's key write access to `surety.streak` only, and registers the non-transferable
    /// subname pointing at it. Split out of `issuePolicy` to avoid stack-too-deep.
    function _setUpEnsRecords(bytes32 node, IssueParams calldata p, uint256 premium)
        internal
        returns (address resolverProxy)
    {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({
            account: address(this),
            roleBitmap: EnsRoles.ROLE_SET_TEXT | EnsRoles.ROLE_SET_TEXT_ADMIN | EnsRoles.ROLE_SET_ADDRESS
                | EnsRoles.ROLE_SET_ADDRESS_ADMIN
        });
        bytes memory initData =
            abi.encodeCall(IEnsResolverInitializable.initialize, (grants, new bytes[](0)));
        resolverProxy = verifiableFactory.deployProxy(permissionedResolverImpl, uint256(node), initData);

        bytes memory dnsName = _dnsEncode(p.label);
        IEnsPermissionedResolver resolver = IEnsPermissionedResolver(resolverProxy);
        resolver.multicall(_buildRecordCalls(dnsName, p, premium));
        resolver.grantSetterRoles(abi.encodeCall(resolver.setText, (dnsName, "surety.streak", "")), p.agent);

        // Non-transferable: `roleBitmap` below omits `ROLE_CAN_TRANSFER_ADMIN` entirely (PRD §10.2).
        ensRegistry.register(p.label, msg.sender, IEnsSubRegistry(address(0)), resolverProxy, 0, type(uint64).max);
        emit PolicyResolverDeployed(node, resolverProxy);
    }

    function _buildRecordCalls(bytes memory dnsName, IssueParams calldata p, uint256 premium)
        internal
        view
        returns (bytes[] memory calls)
    {
        calls = new bytes[](9);
        calls[0] = abi.encodeCall(
            IEnsPermissionedResolver.setText, (dnsName, "surety.coverageLimit", p.coverageLimit.toString())
        );
        calls[1] =
            abi.encodeCall(IEnsPermissionedResolver.setText, (dnsName, "surety.perTxCap", p.perTxCap.toString()));
        calls[2] = abi.encodeCall(
            IEnsPermissionedResolver.setText, (dnsName, "surety.tier", uint256(p.tier).toString())
        );
        calls[3] =
            abi.encodeCall(IEnsPermissionedResolver.setText, (dnsName, "surety.allowlist", _joinAllowlist(p.allowlist)));
        calls[4] = abi.encodeCall(IEnsPermissionedResolver.setText, (dnsName, "surety.premium", premium.toString()));
        calls[5] = abi.encodeCall(IEnsPermissionedResolver.setText, (dnsName, "surety.streak", "0"));
        calls[6] = abi.encodeCall(
            IEnsPermissionedResolver.setText, (dnsName, "surety.policyholder", msg.sender.toHexString())
        );
        calls[7] = abi.encodeCall(IEnsPermissionedResolver.setText, (dnsName, "surety.status", "active"));
        calls[8] = abi.encodeCall(
            IEnsPermissionedResolver.setAddress,
            (dnsName, EnsRoles.COIN_TYPE_ETH, abi.encodePacked(p.agent))
        );
    }

    /// @dev Published as plain lowercase hex, not EIP-55 checksummed — a documented simplification
    /// (this string is display-only; on-chain enforcement always reads `_allowlist`, never this).
    function _joinAllowlist(address[] calldata allowlist) internal pure returns (string memory joined) {
        for (uint256 i = 0; i < allowlist.length; i++) {
            joined = i == 0 ? allowlist[i].toHexString() : string.concat(joined, ",", allowlist[i].toHexString());
        }
    }

    /// @dev DNS-wire-encodes `<label>.<parentLabel>.eth` — length-prefixed labels, zero-terminated.
    /// Resolver setters (`setText`/`setAddress`) take this, not a `bytes32 node`; the resolver derives
    /// the node internally (`NameCoder.namehash`) — see docs/ARCHITECTURE.md#ens.
    function _dnsEncode(string calldata label) internal view returns (bytes memory) {
        bytes memory labelBytes = bytes(label);
        bytes memory parentBytes = bytes(parentLabel);
        require(labelBytes.length > 0 && labelBytes.length < 256, "PolicyRegistry: bad label");
        return abi.encodePacked(
            uint8(labelBytes.length), labelBytes, uint8(parentBytes.length), parentBytes, uint8(3), "eth", uint8(0)
        );
    }
}
