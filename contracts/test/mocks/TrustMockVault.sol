// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentVault} from "../../src/interfaces/IAgentVault.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {ISuretyHook} from "../../src/interfaces/ISuretyHook.sol";
import {Payment, PolicyRecord, ViolationType} from "../../src/interfaces/SuretyTypes.sol";

/// @dev Test/devnet stand-in for Person A's AgentVault. Records payments like the real vault and
/// fakes the hook's swap enforcement so the backend and frontend can run end-to-end before
/// the real v4 hook exists. Struct layouts match Uniswap v4 so the ABI is identical.
contract TrustMockVault is IAgentVault {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    event SwapExecuted(bytes32 indexed node, uint256 amountIn, uint256 amountOut);

    IPolicyRegistry public registry;
    mapping(uint256 => Payment) internal _payments;
    uint256 public paymentCount;

    function setRegistry(IPolicyRegistry r) external {
        registry = r;
    }

    /// @dev Tests inject payments directly.
    function record(bytes32 node, address to, uint256 amount) public returns (uint256 id) {
        id = ++paymentCount;
        _payments[id] = Payment(node, to, amount, uint64(block.timestamp));
        emit PaymentMade(node, id, to, amount);
    }

    function deposit(bytes32 node, uint256 amount) external {
        emit Deposited(node, amount);
    }

    function pay(bytes32 node, address to, uint256 amount) external returns (uint256) {
        if (address(registry) != address(0)) require(msg.sender == registry.getPolicy(node).agent, "only agent");
        return record(node, to, amount);
    }

    function swap(bytes32 node, PoolKey calldata, SwapParams calldata params, address counterparty) external {
        PolicyRecord memory p = registry.getPolicy(node);
        require(msg.sender == p.agent, "only agent");
        uint256 amountIn =
            uint256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified);
        if (amountIn > p.perTxCap) revert ISuretyHook.PolicyViolation(node, ViolationType.CapBreach);
        if (!registry.isAllowed(node, counterparty)) {
            revert ISuretyHook.PolicyViolation(node, ViolationType.OffAllowlist);
        }
        emit SwapExecuted(node, amountIn, amountIn);
    }

    function withdraw(bytes32, uint256) external pure {}

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    function balanceOf(bytes32) external pure returns (uint256) {
        return 0;
    }
}
