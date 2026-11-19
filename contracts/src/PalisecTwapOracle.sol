// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3, IPalisecPoolSource, IPalisecPriceOracle} from "./interfaces.sol";

/**
 * @title PalisecTwapOracle
 * @notice Time-weighted average price of $PALISEC from one pool, in USD through Chainlink ETH/USD.
 *
 * Anyone may `poke()` (a keeper does it every few minutes). Each poke closes the interval since the
 * previous one at the price recorded *then* (as Uniswap v2 does), so a price pushed in the same block as
 * a poke only affects intervals after it. `usdPerTokenE18()` refuses (reverts) unless:
 *  - observations cover the whole window with no gap longer than `maxGap` (a missed keeper restarts it),
 *  - the latest poke is at most `maxGap` old,
 *  - the current spot is within `maxDeviationBps` of the TWAP,
 *  - the pool's ETH side is worth at least `minDepthUsdE6`,
 *  - ETH/USD is fresh.
 * No admin: every parameter is fixed at deployment. A new pool means a new oracle.
 */
contract PalisecTwapOracle is IPalisecPriceOracle {
    IPalisecPoolSource public immutable source;
    IAggregatorV3 public immutable ethUsdFeed;
    uint32 public immutable window;
    uint32 public immutable minInterval;
    uint32 public immutable maxGap;
    uint16 public immutable maxDeviationBps;
    uint256 public immutable minDepthUsdE6;
    uint32 public immutable maxEthPriceAge;
    uint8 private immutable feedDecimals;

    uint16 public constant SIZE = 256;

    struct Observation {
        uint64 timestamp;
        uint256 cumulative; // sum of ethPerTokenE18 * seconds
    }

    Observation[SIZE] public observations;
    uint16 public index; // slot of the latest observation
    uint16 public count; // observations stored (<= SIZE)
    uint256 public lastSpot; // ethPerTokenE18 recorded at the latest poke
    uint64 public windowStart; // first poke of the current unbroken run

    event Poked(uint64 timestamp, uint256 spot, uint256 cumulative);

    error TooSoon();
    error WindowIncomplete();
    error StaleObservation();
    error DeviationTooHigh(uint256 spot, uint256 twap);
    error PoolTooThin(uint256 depthUsdE6);
    error StalePrice();
    error BadParams();

    constructor(
        IPalisecPoolSource source_,
        IAggregatorV3 ethUsdFeed_,
        uint32 window_,
        uint32 minInterval_,
        uint32 maxGap_,
        uint16 maxDeviationBps_,
        uint256 minDepthUsdE6_,
        uint32 maxEthPriceAge_
    ) {
        if (address(source_) == address(0) || address(ethUsdFeed_) == address(0)) revert BadParams();
        if (window_ < 300 || minInterval_ == 0 || maxGap_ < minInterval_ || maxGap_ > window_ || maxDeviationBps_ == 0 || maxDeviationBps_ > 5_000) revert BadParams();
        // The ring must hold a full window at the fastest poke rate.
        if (uint256(window_) / minInterval_ + 2 > SIZE) revert BadParams();
        source = source_;
        ethUsdFeed = ethUsdFeed_;
        window = window_;
        minInterval = minInterval_;
        maxGap = maxGap_;
        maxDeviationBps = maxDeviationBps_;
        minDepthUsdE6 = minDepthUsdE6_;
        maxEthPriceAge = maxEthPriceAge_;
        feedDecimals = ethUsdFeed_.decimals();
        if (feedDecimals > 18) revert BadParams();
    }

    /// Records the pool's current price. Callable by anyone, at most once per `minInterval`.
    function poke() external {
        (uint256 spot,) = source.spot();
        uint64 nowTs = uint64(block.timestamp);
        if (count == 0) {
            observations[0] = Observation(nowTs, 0);
            count = 1;
            windowStart = nowTs;
        } else {
            Observation memory last = observations[index];
            if (nowTs < last.timestamp + minInterval) revert TooSoon();
            uint64 dt = nowTs - last.timestamp;
            // A gap longer than maxGap breaks the run: the window must fill again before prices are served.
            if (dt > maxGap) windowStart = nowTs;
            uint256 cumulative = last.cumulative + lastSpot * dt;
            index = uint16((index + 1) % SIZE);
            observations[index] = Observation(nowTs, cumulative);
            if (count < SIZE) count++;
        }
        lastSpot = spot;
        emit Poked(nowTs, spot, observations[index].cumulative);
    }

    /// TWAP in wei per token (18 decimals) over the last `window` seconds.
    function twapEthPerTokenE18() public view returns (uint256) {
        if (count == 0) revert WindowIncomplete();
        Observation memory last = observations[index];
        uint256 nowTs = block.timestamp;
        if (nowTs - last.timestamp > maxGap) revert StaleObservation();
        uint256 target = nowTs - window;
        if (windowStart > target) revert WindowIncomplete();
        // Newest observation at or before the window start.
        Observation memory old;
        bool found;
        for (uint256 i = 0; i < count; i++) {
            Observation memory o = observations[(uint256(index) + SIZE - i) % SIZE];
            if (o.timestamp <= target) {
                old = o;
                found = true;
                break;
            }
        }
        if (!found) revert WindowIncomplete();
        uint256 cumNow = last.cumulative + lastSpot * (nowTs - last.timestamp);
        return (cumNow - old.cumulative) / (nowTs - old.timestamp);
    }

    /// @inheritdoc IPalisecPriceOracle
    function usdPerTokenE18() external view returns (uint256) {
        uint256 twap = twapEthPerTokenE18();
        (uint256 spot, uint256 depthWei) = source.spot();
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        if (diff * 10_000 > twap * maxDeviationBps) revert DeviationTooHigh(spot, twap);
        uint256 ethUsd = _ethUsd();
        // depth (wei) * price (feed decimals) -> USD with 6 decimals
        uint256 depthUsdE6 = (depthWei * ethUsd) / (10 ** (12 + uint256(feedDecimals)));
        if (depthUsdE6 < minDepthUsdE6) revert PoolTooThin(depthUsdE6);
        return (twap * ethUsd) / (10 ** uint256(feedDecimals));
    }

    function _ethUsd() private view returns (uint256) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxEthPriceAge || answeredInRound < roundId) revert StalePrice();
        return uint256(answer);
    }
}
