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

    /// @notice Total vault shares outstanding — an ERC-4626-style claim on this vault's real LP
    /// position, not a fixed nominal USDC entitlement. This is what makes fee income actually reach
    /// backers: a share's redeemable value is `totalLiquidity * yourShares / totalShares` at withdrawal
    /// time, so if the position's value has grown from trading fees since your shares were minted, your
    /// existing shares are worth more automatically — nobody needs to "claim a fee bonus" separately.
    /// (An earlier version of this contract paid out a fixed nominal entitlement instead, which left
    /// fee income permanently stranded in the vault, unclaimed by anyone — see git history.)
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    /// @dev Reward-per-principal accumulator (MasterChef/StakingRewards pattern), denominated in VAULT
    /// SHARES per unit of backer principal: O(1) per premium deposit and per backer action no matter
    /// how many backers exist — minting shares to every backer in a loop on every single premium charge
    /// would make `issuePolicy` gas cost unbounded (this repo has been load-tested with 1,000 distinct
    /// backers/policyholders; see docs/DEEP_VERIFICATION.md).
    uint256 public accSharesPerPrincipal;
    mapping(address => uint256) public shareDebt;

    /// @notice Premium received while totalBackerPrincipal == 0 (no backer to attribute shares to yet);
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
        shareDebt[backer] = backerPrincipal[backer] * accSharesPerPrincipal / WAD;
        emit BackerPrincipalCredited(backer, amount);
    }

    function _settle(address backer) internal {
        uint256 accrued = backerPrincipal[backer] * accSharesPerPrincipal / WAD;
        uint256 pending = accrued - shareDebt[backer];
        if (pending > 0) {
            sharesOf[backer] += pending;
            // Without this, the next _settle would recompute the same `accrued - shareDebt` gap and
            // credit the same shares again — shareDebt must track what's already been folded in.
            shareDebt[backer] = accrued;
        }
    }

    /// @notice Vault shares currently owed to `backer` (already-settled balance plus any pending
    /// accrual since their last principal change) — see `pendingYieldValue` for an approximate USDC
    /// reading of what that's worth right now.
    function pendingYield(address backer) public view returns (uint256) {
        uint256 accrued = backerPrincipal[backer] * accSharesPerPrincipal / WAD;
        return sharesOf[backer] + (accrued - shareDebt[backer]);
    }

    /// @notice Display-only approximation of `backer`'s pending shares in current USDC-side terms.
    /// `withdrawYield` never uses this — it redeems shares directly against real liquidity, so this
    /// value cannot be stale-priced into an unfair payout.
    function pendingYieldValue(address backer) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return totalYieldVaultValue() * pendingYield(backer) / totalShares;
    }

    ////////////////////////////////////////////////////////////////////////
    // Premium intake — called by PolicyRegistry only
    ////////////////////////////////////////////////////////////////////////

    function depositPremiumShare(uint256 amount) external {
        if (msg.sender != policyRegistry) revert NotPolicyRegistry(msg.sender);

        // Snapshot value BEFORE pulling in the new amount, so newly-minted shares are priced fairly
        // against what the vault was worth a moment ago — existing shareholders' per-share value is
        // unaffected by someone else's deposit (standard vault fairness property).
        uint256 valueBefore = totalYieldVaultValue();
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        if (totalBackerPrincipal == 0) {
            // No backer exists yet to own shares for this — leave undeployed rather than mint shares
            // nobody can be attributed to.
            undistributedPremium += amount;
            emit PremiumShareDeposited(amount, 0);
            return;
        }

        uint256 stranded = undistributedPremium;
        undistributedPremium = 0;
        uint256 toMintAgainst = amount + stranded;
        // `stranded` (if any) already sits inside `valueBefore`'s balance but owns no shares yet —
        // price it against everything ELSE in the vault, not against itself, or it would be counted
        // on both sides of the share-price fraction.
        uint256 priceBasis = valueBefore - stranded;

        uint256 sharesToMint =
            (totalShares == 0 || priceBasis == 0) ? toMintAgainst : toMintAgainst * totalShares / priceBasis;
        totalShares += sharesToMint;
        accSharesPerPrincipal += sharesToMint * WAD / totalBackerPrincipal;

        uint128 added = _addLiquidity(toMintAgainst);
        emit PremiumShareDeposited(amount, added);
    }

    ////////////////////////////////////////////////////////////////////////
    // Backer yield withdrawal
    ////////////////////////////////////////////////////////////////////////

    /// @notice Redeems the caller's shares for their exact proportional slice of the vault's REAL
    /// current LP position (`totalLiquidity * shares / totalShares`) and pays out whatever the pool
    /// actually returns for that slice — automatically including any trading-fee growth (or
    /// impermanent-loss shrinkage) since those shares were minted. Expected and acceptable to net
    /// either way — see the contract-level doc comment.
    function withdrawYield() external returns (uint256 amount0, uint256 amount1) {
        _settle(msg.sender);
        uint256 shares = sharesOf[msg.sender];
        if (shares == 0) revert NothingToWithdraw();
        sharesOf[msg.sender] = 0;

        // shares <= totalShares always, so this ratio can never exceed totalLiquidity (already
        // uint128) — the narrowing cast below is safe by construction, not merely hoped-safe. Computed
        // before totalShares is decremented, against the same denominator `shares` was drawn from.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 liquidityToRemove = uint128(uint256(totalLiquidity) * shares / totalShares);
        totalShares -= shares;

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
