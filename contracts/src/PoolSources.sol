// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPalisecPoolSource} from "./interfaces.sol";

/// 512-bit multiply then divide (Remco Bloemen's algorithm), as used by Uniswap's FullMath. Reverts on overflow.
library FullMath {
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            require(denominator > prod1, "mulDiv");
            if (prod1 == 0) {
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (0 - denominator);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            result = prod0 * inv;
        }
    }
}

/// Uniswap v4 StateView (the parts used).
interface IStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}

/**
 * @notice Spot price of $PALISEC in ETH from a Uniswap v4 pool (native ETH or WETH paired with the token),
 * read through the official StateView lens. Depth is the ETH side of the pool's virtual reserves.
 */
contract UniswapV4PoolSource is IPalisecPoolSource {
    uint256 private constant Q96 = 2 ** 96;
    IStateView public immutable stateView;
    bytes32 public immutable poolId;
    /// True when ETH is currency0 (native ETH, address 0, always sorts first).
    bool public immutable ethIsCurrency0;

    constructor(IStateView stateView_, bytes32 poolId_, bool ethIsCurrency0_) {
        stateView = stateView_;
        poolId = poolId_;
        ethIsCurrency0 = ethIsCurrency0_;
    }

    function spot() external view returns (uint256 ethPerTokenE18, uint256 ethDepthWei) {
        (uint160 sqrtPriceX96,,,) = stateView.getSlot0(poolId);
        uint128 liquidity = stateView.getLiquidity(poolId);
        require(sqrtPriceX96 != 0, "pool not initialized");
        if (ethIsCurrency0) {
            // price = token1 per token0 = sqrtP^2 / 2^192 -> ETH per token = 2^192 / sqrtP^2
            ethPerTokenE18 = FullMath.mulDiv(FullMath.mulDiv(1e18, Q96, sqrtPriceX96), Q96, sqrtPriceX96);
            ethDepthWei = FullMath.mulDiv(liquidity, Q96, sqrtPriceX96);
        } else {
            ethPerTokenE18 = FullMath.mulDiv(FullMath.mulDiv(1e18, sqrtPriceX96, Q96), sqrtPriceX96, Q96);
            ethDepthWei = FullMath.mulDiv(liquidity, sqrtPriceX96, Q96);
        }
    }
}

interface IPonsCurve {
    function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve);
}

/**
 * @notice Spot price from a Pons V2 bonding curve before graduation: virtual ETH reserve / token reserve.
 * Depth is the ETH the curve really holds. Used to test the oracle on mainnet state; option A in the
 * Plan prices from the graduated Uniswap v4 pool instead.
 */
contract PonsCurveSource is IPalisecPoolSource {
    IPonsCurve public immutable curve;

    constructor(IPonsCurve curve_) {
        curve = curve_;
    }

    function spot() external view returns (uint256 ethPerTokenE18, uint256 ethDepthWei) {
        (uint256 ethReserve, uint256 tokenReserve) = curve.getReserves();
        require(tokenReserve != 0, "empty curve");
        ethPerTokenE18 = FullMath.mulDiv(ethReserve, 1e18, tokenReserve);
        ethDepthWei = address(curve).balance;
    }
}
