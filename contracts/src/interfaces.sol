// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC20Burnable is IERC20 {
    function burnFrom(address account, uint256 amount) external;
}

/// Chainlink AggregatorV3Interface (the parts used).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// Time-weighted USD price of one $PALISEC (18 decimals). Reverts when no safe price exists.
interface IPalisecPriceOracle {
    function usdPerTokenE18() external view returns (uint256);
}

/// Spot price of $PALISEC in ETH and the pool's ETH-side depth, from one pool.
interface IPalisecPoolSource {
    /// @return ethPerTokenE18 wei per 1e18 token units
    /// @return ethDepthWei the ETH (wei) on the pool's ETH side
    function spot() external view returns (uint256 ethPerTokenE18, uint256 ethDepthWei);
}
