// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPalisecPoolSource, IPalisecPriceOracle} from "../src/interfaces.sol";

contract MockERC20 {
    string public name;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, uint8 d) {
        name = n;
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// OpenZeppelin ERC20Burnable.burnFrom semantics: spend allowance, then burn.
    function burnFrom(address from, uint256 amount) public virtual {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}

/// Returns false instead of reverting (non-standard ERC-20).
contract FalseReturningERC20 is MockERC20 {
    constructor() MockERC20("False", 6) {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// Burns less than asked (a broken or malicious token).
contract ShortBurnERC20 is MockERC20 {
    constructor() MockERC20("Short", 18) {}

    function burnFrom(address from, uint256 amount) public override {
        super.burnFrom(from, amount - 1);
    }
}

contract MockFeed {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    uint80 public roundId = 10;
    uint80 public answeredInRound = 10;

    constructor(uint8 d, int256 a) {
        decimals = d;
        answer = a;
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
    }

    function set(int256 a, uint256 at) external {
        answer = a;
        updatedAt = at;
    }

    function setStartedAt(uint256 s) external {
        startedAt = s;
    }

    function setRounds(uint80 r, uint80 answered) external {
        roundId = r;
        answeredInRound = answered;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract MockSource is IPalisecPoolSource {
    uint256 public price;
    uint256 public depth;

    function set(uint256 p, uint256 d) external {
        price = p;
        depth = d;
    }

    function spot() external view returns (uint256, uint256) {
        return (price, depth);
    }
}

contract MockOracle is IPalisecPriceOracle {
    uint256 public price;
    bool public fail;

    function set(uint256 p, bool f) external {
        price = p;
        fail = f;
    }

    function usdPerTokenE18() external view returns (uint256) {
        require(!fail, "oracle refused");
        return price;
    }
}

/// Re-enters the credits contract when it receives an ETH refund.
contract ReentrantBuyer {
    address public target;
    bool public attacked;

    constructor(address t) {
        target = t;
    }

    function buy(uint256 credits) external payable {
        (bool ok, bytes memory err) = target.call{value: msg.value}(abi.encodeWithSignature("buyWithEth(bytes32,uint256)", bytes32("evil"), credits));
        if (!ok) {
            assembly {
                revert(add(err, 32), mload(err))
            }
        }
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            (bool ok,) = target.call{value: 0}(abi.encodeWithSignature("buyWithEth(bytes32,uint256)", bytes32("evil"), uint256(1000)));
            require(ok, "reentry refused");
        }
    }
}

/// A treasury that refuses ETH.
contract RejectingTreasury {
    receive() external payable {
        revert("no");
    }
}
