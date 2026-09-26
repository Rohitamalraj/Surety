// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BaseHook} from "v4-hooks/src/base/BaseHook.sol";

import {ISuretyHook} from "./interfaces/ISuretyHook.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IPremiumYieldVault} from "./interfaces/IPremiumYieldVault.sol";
import {PolicyRecord, ViolationType} from "./interfaces/SuretyTypes.sol";

/// @notice Owner: Person A. PRD §12, §15.5. A Uniswap v4 hook that is also the pool's liquid reserve:
/// `beforeSwap` blocks over-cap / off-allowlist swaps routed through `AgentVault`, and it holds every
/// MockUSDC premium/backing deposit as the *only* source claim payouts may be released from
/// (CLAUDE.md invariant #1 — there is no LP-split feature here, so `liquidReserve() == usdc.balanceOf`
/// always holds).
contract SuretyHook is ISuretyHook, BaseHook, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IPolicyRegistry public immutable registry;

    /// @notice The only contract allowed to call `depositPremium`.
    address public immutable policyRegistryCaller;

    /// @notice The only contract allowed to route enforced swaps through `beforeSwap`. Wired after
    /// deployment (AgentVault is deployed before the hook, but the hook's constructor args are fixed
    /// by PRD §15.9's deploy order to `(poolManager, registry, usdc)` — no vault address yet).
    address public agentVault;

    /// @notice The only contract allowed to call `releasePayout`. Wired after deployment — ClaimRouter
    /// is deployed after the hook and takes the hook's address as a constructor arg, not vice versa.
    address public claimRouter;

    /// @notice Demo/incident fallback: when false, `beforeSwap` never reverts (PRD §12.3, §15.5).
    bool public enforce = true;

    /// @notice Optional (PRD §21.2 stretch #2): if set, every `depositBacking` call also attributes
    /// that backer's principal to PremiumYieldVault so it can distribute its separate, premium-only
    /// yield pool proportionally. Never receives or risks backer principal itself — see
    /// PremiumYieldVault.sol's own header.
    IPremiumYieldVault public premiumYieldVault;

    error UnauthorizedSender(address sender);
    error PoolNotUsdcPaired();
    error UnsupportedSwapShape();
    error InsufficientReserve(uint256 liquidReserve, uint256 requested);
    error ZeroAddress();

    constructor(IPoolManager _poolManager, IPolicyRegistry _registry, IERC20 _usdc, address _owner)
        BaseHook(_poolManager)
        Ownable(_owner)
    {
        if (address(_registry) == address(0) || address(_usdc) == address(0)) revert ZeroAddress();
        registry = _registry;
        usdc = _usdc;
        policyRegistryCaller = address(_registry);
    }

    ////////////////////////////////////////////////////////////////////////
    // Admin wiring (post-deploy — not part of the locked ISuretyHook API)
    ////////////////////////////////////////////////////////////////////////

    function setAgentVault(address vault) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        agentVault = vault;
    }

    function setClaimRouter(address router) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        claimRouter = router;
    }

    function setEnforce(bool on) external onlyOwner {
        enforce = on;
        emit EnforceSet(on);
    }

    function setPremiumYieldVault(address vault) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        premiumYieldVault = IPremiumYieldVault(vault);
    }

    ////////////////////////////////////////////////////////////////////////
    // ISuretyHook — reserve custody
    ////////////////////////////////////////////////////////////////////////

    /// @inheritdoc ISuretyHook
    function depositPremium(bytes32 node, uint256 amount) external {
        if (msg.sender != policyRegistryCaller) revert UnauthorizedSender(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit PremiumDeposited(node, amount);
    }

    /// @inheritdoc ISuretyHook
    function depositBacking(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (address(premiumYieldVault) != address(0)) {
            premiumYieldVault.creditBackerPrincipal(msg.sender, amount);
        }
        emit BackingDeposited(msg.sender, amount);
    }

    /// @inheritdoc ISuretyHook
    function releasePayout(uint256 claimId, address to, uint256 amount) external {
        if (msg.sender != claimRouter) revert UnauthorizedSender(msg.sender);
        uint256 reserve = liquidReserve();
        if (amount > reserve) revert InsufficientReserve(reserve, amount);
        usdc.safeTransfer(to, amount);
        emit PayoutReleased(claimId, to, amount);
    }

    /// @inheritdoc ISuretyHook
    function liquidReserve() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    ////////////////////////////////////////////////////////////////////////
    // BaseHook
    ////////////////////////////////////////////////////////////////////////

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @dev `hookData` is empty for any swap not routed through Surety's `AgentVault` — the pool stays
    /// open to the public (PRD §12.3). When present, it decodes to `(bytes32 node, address counterparty)`
    /// set by `AgentVault.swap`. `sender` here is `PoolManager.swap`'s direct caller (verified from
    /// `Hooks.beforeSwap`'s `msg.sender` capture — see docs/ARCHITECTURE.md#uniswap), so checking it
    /// against `agentVault` cannot be spoofed by routing through a different, unrelated caller.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length == 0 || !enforce) {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        if (sender != agentVault) revert UnauthorizedSender(sender);

        (bytes32 node, address counterparty) = abi.decode(hookData, (bytes32, address));
        PolicyRecord memory policy = registry.getPolicy(node);
        uint256 amountIn = _usdcAmountIn(key, params);

        if (amountIn > policy.perTxCap) revert PolicyViolation(node, ViolationType.CapBreach);
        if (!registry.isAllowed(node, counterparty)) revert PolicyViolation(node, ViolationType.OffAllowlist);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Enforced swaps are always "spend exactly `amountIn` MockUSDC" (exact-input, selling USDC) —
    /// the only shape `AgentVault.swap` is allowed to construct. Any other shape (buying USDC, or an
    /// exact-output swap) is rejected outright rather than guessed at, since the MockUSDC amount isn't
    /// known pre-trade for those shapes.
    function _usdcAmountIn(PoolKey calldata key, SwapParams calldata params) internal view returns (uint256) {
        bool usdcIsToken0 = Currency.unwrap(key.currency0) == address(usdc);
        bool usdcIsToken1 = Currency.unwrap(key.currency1) == address(usdc);
        if (!usdcIsToken0 && !usdcIsToken1) revert PoolNotUsdcPaired();

        bool sellingUsdc = usdcIsToken0 ? params.zeroForOne : !params.zeroForOne;
        if (!sellingUsdc || params.amountSpecified >= 0) revert UnsupportedSwapShape();

        return uint256(-params.amountSpecified);
    }
}
