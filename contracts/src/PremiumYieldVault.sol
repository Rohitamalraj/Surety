// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @notice Owner: Person A. PRD §12.4 / §21.2 stretch #2: "a configurable share of premiums added as
/// LP liquidity to earn fees. Payouts never come from the LP position." This contract holds ONLY that
/// carved-out premium share — never backer principal, which stays 100% in SuretyHook's flat reserve
/// (CLAUDE.md invariant #1; PolicyRegistry never sends principal here, only PolicyRegistry.issuePolicy's
/// own premium split does). It deploys its holdings one-sided into the real MockUSDC/WETH v4 pool
/// (Currency for USDC in, no other token ever required at deposit time — see `_addLiquidity`), so it
/// may lose value to impermanent loss. That is expected and acceptable: this is yield capital, not
/// reserve capital. Its balance is NEVER read by `SuretyHook.liquidReserve()` or
/// `PolicyRegistry.issuePolicy()`'s 2x solvency check — those only ever read `SuretyHook`'s own token
/// balance, and this vault is a wholly separate contract (see PremiumYieldVault.t.sol's isolation test).
contract PremiumYieldVault is IUnlockCallback, Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_DENOM = 10_000;
    uint256 public constant MAX_YIELD_SHARE_BPS = 5_000;

    IERC20 public immutable usdc;
    IPoolManager public immutable poolManager;
    address public immutable policyRegistry;

    /// @notice Owner-set post-deploy: the pool doesn't exist yet when this vault is constructed (same
    /// reason as AgentVault.setCanonicalPool). One-sided tick range chosen so this vault's deposits are
    /// pure MockUSDC regardless of which side of the pool USDC lands on (see `_addLiquidity`).
    PoolKey public poolKey;
    bool public poolKeySet;
    int24 public tickLower;
    int24 public tickUpper;
    uint128 public totalLiquidity;

    /// @notice Fraction of each premium routed here instead of the reserve, in basis points.
    uint256 public yieldShareBps = 3000;

    /// @notice The only caller allowed to attribute backer principal — SuretyHook, wired post-deploy.
    address public suretyHook;

    uint256 public totalBackerPrincipal;
    mapping(address => uint256) public backerPrincipal;

    /// @dev Reward-per-principal accumulator (MasterChef/StakingRewards pattern): O(1) per premium
    /// deposit and per backer action no matter how many backers exist — minting shares to every backer
    /// in a loop on every single premium charge would make `issuePolicy` gas cost unbounded (this repo
    /// has been load-tested with 1,000 distinct backers/policyholders; see docs/DEEP_VERIFICATION.md).
    uint256 public accRewardPerPrincipal;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public claimable;

    /// @notice Premium received while totalBackerPrincipal == 0 (no backer to attribute it to yet);
    /// rolled into the next distribution instead of divided by zero or silently lost.
    uint256 public undistributedPremium;

    struct ModifyCallbackData {
        int256 liquidityDelta;
    }

    event YieldShareSet(uint256 bps);
    event PoolPositionSet(int24 tickLower, int24 tickUpper);
    event SuretyHookSet(address hook);
    event PremiumShareDeposited(uint256 amount, uint128 liquidityAdded);
    event BackerPrincipalCredited(address indexed backer, uint256 amount);
    event YieldWithdrawn(address indexed backer, uint256 amount0, uint256 amount1);

    error NotPolicyRegistry(address caller);
    error NotSuretyHook(address caller);
    error ExceedsMaxYieldShare(uint256 bps);
    error PoolNotSet();
    error NotPoolManager(address caller);
    error NothingToWithdraw();
    error ZeroAddress();

    constructor(IERC20 _usdc, IPoolManager _poolManager, address _policyRegistry, address _owner)
        Ownable(_owner)
    {
        if (address(_usdc) == address(0) || address(_poolManager) == address(0) || _policyRegistry == address(0)) {
            revert ZeroAddress();
        }
        usdc = _usdc;
        poolManager = _poolManager;
        policyRegistry = _policyRegistry;
    }

    ////////////////////////////////////////////////////////////////////////
    // Admin wiring (post-deploy)
    ////////////////////////////////////////////////////////////////////////

    function setYieldShareBps(uint256 bps) external onlyOwner {
        if (bps > MAX_YIELD_SHARE_BPS) revert ExceedsMaxYieldShare(bps);
        yieldShareBps = bps;
        emit YieldShareSet(bps);
    }

    /// @dev The unlock callback settles both currencies from whatever the pool actually reports
    /// regardless of which one this range was meant to need — a misconfigured range fails safely
    /// (settles/takes both sides correctly) rather than leaving phantom debt.
    function setPoolPosition(PoolKey calldata key, int24 _tickLower, int24 _tickUpper) external onlyOwner {
        poolKey = key;
        poolKeySet = true;
        tickLower = _tickLower;
        tickUpper = _tickUpper;
        emit PoolPositionSet(_tickLower, _tickUpper);
    }

    function setSuretyHook(address hook) external onlyOwner {
        if (hook == address(0)) revert ZeroAddress();
        suretyHook = hook;
        emit SuretyHookSet(hook);
    }

    ////////////////////////////////////////////////////////////////////////
    // Backer principal attribution — called by SuretyHook.depositBacking only
    ////////////////////////////////////////////////////////////////////////

    function creditBackerPrincipal(address backer, uint256 amount) external {
        if (msg.sender != suretyHook) revert NotSuretyHook(msg.sender);
        _settle(backer);
        backerPrincipal[backer] += amount;
        totalBackerPrincipal += amount;
        rewardDebt[backer] = backerPrincipal[backer] * accRewardPerPrincipal / WAD;
        emit BackerPrincipalCredited(backer, amount);
    }

    function _settle(address backer) internal {
        uint256 accrued = backerPrincipal[backer] * accRewardPerPrincipal / WAD;
        uint256 pending = accrued - rewardDebt[backer];
        if (pending > 0) {
            claimable[backer] += pending;
            // Without this, the next _settle would recompute the same `accrued - rewardDebt` gap and
            // credit the same yield again — rewardDebt must track what's already been folded in.
            rewardDebt[backer] = accrued;
        }
    }

    function pendingYield(address backer) public view returns (uint256) {
        uint256 accrued = backerPrincipal[backer] * accRewardPerPrincipal / WAD;
        return claimable[backer] + (accrued - rewardDebt[backer]);
    }

    ////////////////////////////////////////////////////////////////////////
    // Premium intake — called by PolicyRegistry only
    ////////////////////////////////////////////////////////////////////////

    function depositPremiumShare(uint256 amount) external {
        if (msg.sender != policyRegistry) revert NotPolicyRegistry(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toDistribute = amount + undistributedPremium;
        if (totalBackerPrincipal == 0) {
            undistributedPremium = toDistribute;
        } else {
            undistributedPremium = 0;
            accRewardPerPrincipal += toDistribute * WAD / totalBackerPrincipal;
        }

        uint128 added = _addLiquidity(amount);
        emit PremiumShareDeposited(amount, added);
    }

    ////////////////////////////////////////////////////////////////////////
    // Backer yield withdrawal
    ////////////////////////////////////////////////////////////////////////

    /// @notice Unwinds the caller's proportional share of this vault's LP position and pays out
    /// whatever the pool actually returns for it — possibly less than the nominal entitlement if the
    /// position lost value (impermanent loss). Expected and acceptable — see contract-level doc comment.
    function withdrawYield() external returns (uint256 amount0, uint256 amount1) {
        _settle(msg.sender);
        uint256 entitlement = claimable[msg.sender];
        if (entitlement == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;

        uint256 valueBefore = totalYieldVaultValue();
        // Clamp entitlement to valueBefore *before* the division so the ratio can never exceed 1 —
        // guarantees the product below never exceeds totalLiquidity (already uint128), making the
        // narrowing cast safe rather than merely hoped-safe.
        uint256 boundedEntitlement = entitlement > valueBefore ? valueBefore : entitlement;
        uint256 rawLiquidityToRemove = valueBefore == 0 ? 0 : uint256(totalLiquidity) * boundedEntitlement / valueBefore;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 liquidityToRemove = uint128(rawLiquidityToRemove); // <= totalLiquidity (uint128) by the clamp above

        (amount0, amount1) = _removeLiquidity(liquidityToRemove);
        if (amount0 > 0) IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(msg.sender, amount0);
        if (amount1 > 0) IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(msg.sender, amount1);
        emit YieldWithdrawn(msg.sender, amount0, amount1);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice Uncommitted USDC plus this vault's own position value on its USDC-denominated side only
    /// — it does NOT price the paired token in USDC terms (no oracle is introduced for a number nothing
    /// depends on; see `positionComposition` for the real, undistorted breakdown of both sides).
    /// NEVER read by liquidReserve() or any solvency check — see SuretyHook.sol / PolicyRegistry.sol.
    function totalYieldVaultValue() public view returns (uint256) {
        uint256 uncommitted = usdc.balanceOf(address(this));
        if (!poolKeySet || totalLiquidity == 0) return uncommitted;
        (uint256 amount0, uint256 amount1) = positionComposition();
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        return uncommitted + (usdcIsToken0 ? amount0 : amount1);
    }

    /// @notice The vault's LP position broken into both currencies at the pool's current spot price.
    function positionComposition() public view returns (uint256 amount0, uint256 amount1) {
        if (!poolKeySet || totalLiquidity == 0) return (0, 0);
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolKey.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        return _getAmountsForLiquidity(sqrtPriceX96, sqrtLower, sqrtUpper, totalLiquidity);
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal — pool interaction
    ////////////////////////////////////////////////////////////////////////

    /// @dev Assumes the owner-configured [tickLower, tickUpper] is genuinely one-sided for USDC at
    /// today's price. If price has since drifted into or past that range, the pool will legitimately
    /// require some of the paired token too; this vault holds none, so `_settleOrTake` simply fails to
    /// pay it and the whole deposit reverts — a clean revert, never a fund-safety issue, but an
    /// operational one (the owner must keep the range current via `setPoolPosition`).
    function _addLiquidity(uint256 usdcAmount) internal returns (uint128 addedLiquidity) {
        if (!poolKeySet) revert PoolNotSet();
        if (usdcAmount == 0) return 0;
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == address(usdc);
        addedLiquidity = usdcIsToken0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, usdcAmount)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, usdcAmount);
        if (addedLiquidity == 0) return 0;

        poolManager.unlock(abi.encode(ModifyCallbackData({liquidityDelta: int256(uint256(addedLiquidity))})));
        totalLiquidity += addedLiquidity;
    }

    function _removeLiquidity(uint128 liquidity) internal returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) return (0, 0);
        bytes memory result =
            poolManager.unlock(abi.encode(ModifyCallbackData({liquidityDelta: -int256(uint256(liquidity))})));
        BalanceDelta delta = abi.decode(result, (BalanceDelta));
        totalLiquidity -= liquidity;
        amount0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        amount1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager(msg.sender);
        ModifyCallbackData memory data = abi.decode(rawData, (ModifyCallbackData));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: data.liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );
        _settleOrTake(poolKey.currency0, delta.amount0());
        _settleOrTake(poolKey.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settleOrTake(Currency currency, int128 amount) internal {
        if (amount < 0) {
            poolManager.sync(currency);
            // forge-lint: disable-next-line(unsafe-typecast)
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), uint256(uint128(-amount))); // amount < 0 checked above, so -amount fits int128 and is non-negative
            poolManager.settle();
        } else if (amount > 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            poolManager.take(currency, address(this), uint256(uint128(amount))); // amount > 0 checked above
        }
    }

    /// @dev Reverse of LiquidityAmounts.getLiquidityForAmount0/1 (production LiquidityAmounts.sol only
    /// ships the forward direction) — same standard formulas, written locally to avoid importing a
    /// test-utils file into production source.
    function _getAmountsForLiquidity(
        uint160 sqrtPriceX96,
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (sqrtPriceAX96 > sqrtPriceBX96) (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        if (sqrtPriceX96 <= sqrtPriceAX96) {
            amount0 = _getAmount0ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity);
        } else if (sqrtPriceX96 < sqrtPriceBX96) {
            amount0 = _getAmount0ForLiquidity(sqrtPriceX96, sqrtPriceBX96, liquidity);
            amount1 = _getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceX96, liquidity);
        } else {
            amount1 = _getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity);
        }
    }

    function _getAmount0ForLiquidity(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtPriceAX96 > sqrtPriceBX96) (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        return FullMath.mulDiv(uint256(liquidity) << FixedPoint96.RESOLUTION, sqrtPriceBX96 - sqrtPriceAX96, sqrtPriceBX96)
            / sqrtPriceAX96;
    }

    function _getAmount1ForLiquidity(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtPriceAX96 > sqrtPriceBX96) (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        return FullMath.mulDiv(liquidity, sqrtPriceBX96 - sqrtPriceAX96, FixedPoint96.Q96);
    }
}
