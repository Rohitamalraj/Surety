// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {Payment, PolicyRecord} from "./interfaces/SuretyTypes.sol";

/// @notice Owner: Person A. PRD §15.4. Every agent's spending wallet, keyed by ENS node. `pay()` records
/// every transfer and never blocks on a rule breach — a recorded breach is the insured event (PRD §4.2).
/// `swap()` calls Uniswap v4's `PoolManager` *directly* (implementing `IUnlockCallback` itself) rather
/// than through the shared `PoolSwapTest` router: `SuretyHook.beforeSwap`'s `sender` check only works
/// because `sender` is whoever calls `PoolManager.swap()` directly — see docs/ARCHITECTURE.md#uniswap.
///
/// `swap()` only accepts the one owner-pinned `canonicalPoolKey` — without this, an agent (or anything
/// that can call `swap`) could pass an arbitrary `PoolKey` with `hooks: address(0)` or any hook other
/// than `SuretyHook`, moving funds through a pool that never runs `beforeSwap` at all and skipping
/// enforcement entirely. Found by the adversarial fork tests in `contracts/test/fork/` — see
/// docs/ARCHITECTURE.md#uniswap.
contract AgentVault is IAgentVault, IUnlockCallback, Ownable {
    using SafeERC20 for IERC20;

    IPolicyRegistry public immutable registry;
    IERC20 public immutable usdc;
    IPoolManager public immutable poolManager;

    /// @notice The only pool `swap()` will route through — set once by the owner after the real pool
    /// is initialized (PRD §15.9 step 9, after AgentVault is already deployed at step 4).
    PoolKey public canonicalPoolKey;
    bool public canonicalPoolKeySet;

    mapping(bytes32 => uint256) internal _balances;
    Payment[] internal _payments;

    struct SwapCallbackData {
        bytes32 node;
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    event SwapExecuted(bytes32 indexed node, uint256 amountIn, uint256 amountOut);
    event CanonicalPoolSet(bytes32 poolId);

    error NotAgent(bytes32 node, address caller);
    error NotPolicyholder(bytes32 node, address caller);
    error InsufficientBalance(bytes32 node, uint256 requested, uint256 available);
    error OnlyExactInputUsdcSwapsSupported();
    error PoolNotUsdcPaired();
    error InvalidPaymentId(uint256 paymentId);
    error NotPoolManager(address caller);
    error CanonicalPoolNotSet();
    error UnauthorizedPool();
    error UnexpectedPositiveUsdcDelta();

    constructor(IPolicyRegistry _registry, IERC20 _usdc, IPoolManager _poolManager, address _owner)
        Ownable(_owner)
    {
        registry = _registry;
        usdc = _usdc;
        poolManager = _poolManager;
    }

    /// @notice Owner-only, post-deploy wiring: the one pool `swap()` is allowed to use. Pins currencies,
    /// fee, tick spacing, and — critically — the hook, so nothing can substitute an unprotected pool.
    function setCanonicalPool(PoolKey calldata key) external onlyOwner {
        canonicalPoolKey = key;
        canonicalPoolKeySet = true;
        emit CanonicalPoolSet(keccak256(abi.encode(key)));
    }

    /// @inheritdoc IAgentVault
    function deposit(bytes32 node, uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _balances[node] += amount;
        emit Deposited(node, amount);
    }

    /// @inheritdoc IAgentVault
    function pay(bytes32 node, address to, uint256 amount) external returns (uint256 paymentId) {
        PolicyRecord memory policy = registry.getPolicy(node);
        if (msg.sender != policy.agent) revert NotAgent(node, msg.sender);
        if (_balances[node] < amount) revert InsufficientBalance(node, amount, _balances[node]);

        _balances[node] -= amount;
        usdc.safeTransfer(to, amount);

        _payments.push(Payment({node: node, to: to, amount: amount, timestamp: uint64(block.timestamp)}));
        paymentId = _payments.length;
        emit PaymentMade(node, paymentId, to, amount);
    }

    /// @notice Only the policyholder — pulls unspent deposited MockUSDC back out of the vault.
    function withdraw(bytes32 node, uint256 amount) external {
        PolicyRecord memory policy = registry.getPolicy(node);
        if (msg.sender != policy.policyholder) revert NotPolicyholder(node, msg.sender);
        if (_balances[node] < amount) revert InsufficientBalance(node, amount, _balances[node]);
        _balances[node] -= amount;
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Only the policy's agent. Spends exactly `amountIn` MockUSDC (exact-input, selling USDC —
    /// the only shape `SuretyHook.beforeSwap` accepts) from `node`'s deposited balance via the v4 pool
    /// keyed by `key`; `counterparty` is passed through `hookData` for the allowlist check.
    function swap(bytes32 node, PoolKey calldata key, SwapParams calldata params, address counterparty) external {
        PolicyRecord memory policy = registry.getPolicy(node);
        if (msg.sender != policy.agent) revert NotAgent(node, msg.sender);
        if (!canonicalPoolKeySet) revert CanonicalPoolNotSet();
        if (keccak256(abi.encode(key)) != keccak256(abi.encode(canonicalPoolKey))) revert UnauthorizedPool();

        // Upper bound only — a price-limited swap can partially fill and settle less than requested.
        // The actual debit below always uses what was really spent, never this requested amount.
        uint256 requestedIn = _usdcAmountIn(key, params);
        if (_balances[node] < requestedIn) revert InsufficientBalance(node, requestedIn, _balances[node]);

        bytes memory hookData = abi.encode(node, counterparty);
        bytes memory result = poolManager.unlock(abi.encode(SwapCallbackData(node, key, params, hookData)));
        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        bool usdcIsToken0 = Currency.unwrap(key.currency0) == address(usdc);
        int128 usdcDelta = usdcIsToken0 ? delta.amount0() : delta.amount1();
        if (usdcDelta > 0) revert UnexpectedPositiveUsdcDelta();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 actualIn = uint256(uint128(-usdcDelta)); // guarded by the `> 0` check above
        _balances[node] -= actualIn;

        int128 outputDelta = usdcIsToken0 ? delta.amount1() : delta.amount0();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountOut = outputDelta > 0 ? uint256(uint128(outputDelta)) : 0; // guarded by the `> 0` check
        emit SwapExecuted(node, actualIn, amountOut);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager(msg.sender);
        SwapCallbackData memory data = abi.decode(rawData, (SwapCallbackData));

        BalanceDelta delta = poolManager.swap(data.key, data.params, data.hookData);

        if (delta.amount0() < 0) _settle(data.key.currency0, uint256(uint128(-delta.amount0())));
        if (delta.amount1() < 0) _settle(data.key.currency1, uint256(uint128(-delta.amount1())));
        if (delta.amount0() > 0) poolManager.take(data.key.currency0, address(this), uint256(uint128(delta.amount0())));
        if (delta.amount1() > 0) poolManager.take(data.key.currency1, address(this), uint256(uint128(delta.amount1())));

        return abi.encode(delta);
    }

    /// @inheritdoc IAgentVault
    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        if (paymentId == 0 || paymentId > _payments.length) revert InvalidPaymentId(paymentId);
        return _payments[paymentId - 1];
    }

    /// @inheritdoc IAgentVault
    function balanceOf(bytes32 node) external view returns (uint256) {
        return _balances[node];
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal
    ////////////////////////////////////////////////////////////////////////

    /// @dev Pays what the vault owes the pool for this swap. The vault is always the payer of its own
    /// held balance (never someone else's approval), so this is the simple `transfer` branch of the
    /// standard v4 settle pattern — see `v4-core/test/utils/CurrencySettler.sol` for the general form.
    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    /// @dev Mirrors SuretyHook's own check (docs/ARCHITECTURE.md#uniswap): enforced swaps are always
    /// "spend exactly `amountIn` MockUSDC" so the hook can read the cap pre-trade without a price quote.
    function _usdcAmountIn(PoolKey calldata key, SwapParams calldata params) internal view returns (uint256) {
        bool usdcIsToken0 = Currency.unwrap(key.currency0) == address(usdc);
        bool usdcIsToken1 = Currency.unwrap(key.currency1) == address(usdc);
        if (!usdcIsToken0 && !usdcIsToken1) revert PoolNotUsdcPaired();

        bool sellingUsdc = usdcIsToken0 ? params.zeroForOne : !params.zeroForOne;
        if (!sellingUsdc || params.amountSpecified >= 0) revert OnlyExactInputUsdcSwapsSupported();

        return uint256(-params.amountSpecified);
    }
}
