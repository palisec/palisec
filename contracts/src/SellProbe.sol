// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title SellProbe
 * @notice Never deployed. PALISEC's asset-safety simulation places this code at the agent's account
 *         (an eth_simulateV1 state override, in a block after the simulated operation) and calls it,
 *         so it acts with the account's balances: it sends a received token back to the pool it came
 *         from (the first leg of every sell) and measures what the pool actually got. A token that
 *         blocks that transfer is a honeypot; a shortfall is a transfer tax. When the pool is a
 *         Uniswap-V2-style pair it also completes the sell, so the round-trip loss can be measured.
 *         Every external read is guarded, so the probe reports instead of reverting.
 */
contract SellProbe {
    struct Result {
        bool transferred; // the token transfer to the pool succeeded
        uint256 poolReceived; // what the pool's balance grew by
        address outToken; // V2 sell: the token received for it (zero if no V2 sell was possible)
        uint256 outAmount; // V2 sell: how much of it arrived
    }

    function probe(address token, address pool, uint256 amount) external returns (Result memory r) {
        (bool okBefore, uint256 before) = _balanceOf(token, pool);
        (bool sent, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, pool, amount));
        r.transferred = sent && okBefore && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool))));
        if (!r.transferred) return r;
        (bool okAfter, uint256 after_) = _balanceOf(token, pool);
        if (okAfter && after_ > before) r.poolReceived = after_ - before;

        if (okAfter) (r.outToken, r.outAmount) = _v2Sell(token, pool, after_);
    }

    /// Optional V2 sell: amountIn is what the pair holds above its reserve, as the pair itself computes it.
    function _v2Sell(address token, address pool, uint256 poolBalance) private returns (address, uint256) {
        (bool ok, bool zero, address outToken, uint256 rin, uint256 rout) = _pair(pool, token);
        if (!ok || poolBalance <= rin) return (address(0), 0);
        uint256 amountIn = poolBalance - rin;
        uint256 out = (amountIn * 997 * rout) / (rin * 1000 + amountIn * 997);
        if (out == 0) return (address(0), 0);
        return zero ? _swap(pool, outToken, 0, out) : _swap(pool, outToken, out, 0);
    }

    /// token0()/token1()/getReserves() of a V2 pair that trades `token`; ok=false for anything else.
    function _pair(address pool, address token) private view returns (bool, bool, address, uint256, uint256) {
        (bool ok0, address t0) = _address(pool, 0x0dfe1681);
        (bool ok1, address t1) = _address(pool, 0xd21220a7);
        if (!ok0 || !ok1 || (t0 != token && t1 != token)) return (false, false, address(0), 0, 0);
        (bool okR, bytes memory res) = pool.staticcall(abi.encodeWithSelector(0x0902f1ac));
        if (!okR || res.length < 64) return (false, false, address(0), 0, 0);
        (uint256 r0, uint256 r1) = abi.decode(res, (uint256, uint256));
        return t0 == token ? (true, true, t1, r0, r1) : (true, false, t0, r1, r0);
    }

    function _swap(address pool, address outToken, uint256 out0, uint256 out1) private returns (address, uint256) {
        (, uint256 b0) = _balanceOf(outToken, address(this));
        // swap(uint256,uint256,address,bytes)
        (bool swapped,) = pool.call(abi.encodeWithSelector(0x022c0d9f, out0, out1, address(this), new bytes(0)));
        if (!swapped) return (address(0), 0);
        (, uint256 b1) = _balanceOf(outToken, address(this));
        return (outToken, b1 > b0 ? b1 - b0 : 0);
    }

    function _balanceOf(address token, address who) private view returns (bool, uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, who));
        if (!ok || ret.length < 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    function _address(address target, bytes4 selector) private view returns (bool, address) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || ret.length < 32) return (false, address(0));
        return (true, abi.decode(ret, (address)));
    }
}
