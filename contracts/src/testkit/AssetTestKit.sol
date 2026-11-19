// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * Test-only contracts for PALISEC's asset-safety checks (Phase 6): a plain token, a honeypot, a
 * 20%-sell-tax token, a minimal Uniswap-V2-style pair and router. Deployed on a mainnet fork and on
 * testnet only. Never deployed on mainnet, never given real value.
 */

contract KitToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public immutable owner;
    address public pair;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint256 supply) {
        name = n;
        symbol = s;
        owner = msg.sender;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function setPair(address p) external {
        require(msg.sender == owner, "owner");
        pair = p;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance");
            allowance[from][msg.sender] = a - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal virtual {
        _plain(from, to, value);
    }

    function _plain(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// Can be bought from the pair, cannot be sold to it (only the owner can add liquidity).
contract HoneypotToken is KitToken {
    constructor(uint256 supply) KitToken("Honeypot Test", "HONEY", supply) {}

    function _move(address from, address to, uint256 value) internal override {
        require(to != pair || from == owner, "sell blocked");
        _plain(from, to, value);
    }
}

/// 20% of every sell (transfer to the pair, except the owner's) goes to the owner.
contract TaxToken is KitToken {
    uint256 public constant SELL_TAX_BPS = 2000;

    constructor(uint256 supply) KitToken("Tax Test", "TAX20", supply) {}

    function _move(address from, address to, uint256 value) internal override {
        if (to == pair && from != owner && pair != address(0)) {
            uint256 tax = (value * SELL_TAX_BPS) / 10_000;
            _plain(from, owner, tax);
            _plain(from, to, value - tax);
        } else {
            _plain(from, to, value);
        }
    }
}

interface IKitToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Minimal constant-product pair with the Uniswap V2 interface the probe uses.
contract KitPair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, uint32(block.timestamp));
    }

    function sync() public {
        reserve0 = uint112(IKitToken(token0).balanceOf(address(this)));
        reserve1 = uint112(IKitToken(token1).balanceOf(address(this)));
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        require(amount0Out > 0 || amount1Out > 0, "out");
        (uint256 r0, uint256 r1) = (reserve0, reserve1);
        require(amount0Out < r0 && amount1Out < r1, "liquidity");
        if (amount0Out > 0) require(IKitToken(token0).transfer(to, amount0Out), "t0");
        if (amount1Out > 0) require(IKitToken(token1).transfer(to, amount1Out), "t1");
        uint256 b0 = IKitToken(token0).balanceOf(address(this));
        uint256 b1 = IKitToken(token1).balanceOf(address(this));
        uint256 in0 = b0 > r0 - amount0Out ? b0 - (r0 - amount0Out) : 0;
        uint256 in1 = b1 > r1 - amount1Out ? b1 - (r1 - amount1Out) : 0;
        require(in0 > 0 || in1 > 0, "in");
        require((b0 * 1000 - in0 * 3) * (b1 * 1000 - in1 * 3) >= r0 * r1 * 1_000_000, "k");
        sync();
    }
}

/// `swapExactTokensForTokens` (0x38ed1739) over one KitPair, like a V2 router.
contract KitRouter {
    mapping(address => mapping(address => address)) public pairFor;
    address public immutable owner = msg.sender;

    function setPair(address a, address b, address pair) external {
        require(msg.sender == owner, "owner");
        pairFor[a][b] = pair;
        pairFor[b][a] = pair;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts)
    {
        require(block.timestamp <= deadline, "expired");
        require(path.length == 2, "path");
        KitPair pair = KitPair(pairFor[path[0]][path[1]]);
        require(address(pair) != address(0), "pair");
        require(IKitToken(path[0]).transferFrom(msg.sender, address(pair), amountIn), "pull");
        (uint112 r0, uint112 r1,) = pair.getReserves();
        bool zeroIn = path[0] == pair.token0();
        (uint256 rin, uint256 rout) = zeroIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 actualIn = IKitToken(path[0]).balanceOf(address(pair)) - rin;
        uint256 out = (actualIn * 997 * rout) / (rin * 1000 + actualIn * 997);
        require(out >= amountOutMin, "slippage");
        pair.swap(zeroIn ? 0 : out, zeroIn ? out : 0, to, new bytes(0));
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}
