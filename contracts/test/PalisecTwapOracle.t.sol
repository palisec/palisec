// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PalisecTwapOracle} from "../src/PalisecTwapOracle.sol";
import {IAggregatorV3, IPalisecPoolSource} from "../src/interfaces.sol";
import {UniswapV4PoolSource, IStateView} from "../src/PoolSources.sol";
import {MockFeed, MockSource} from "./Mocks.sol";

contract MockStateView is IStateView {
    uint160 public sqrtP;
    uint128 public liq;

    function set(uint160 s, uint128 l) external {
        sqrtP = s;
        liq = l;
    }

    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24) {
        return (sqrtP, 0, 0, 0);
    }

    function getLiquidity(bytes32) external view returns (uint128) {
        return liq;
    }
}

contract PalisecTwapOracleTest is Test {
    MockSource src;
    MockFeed ethUsd;
    PalisecTwapOracle oracle;
    uint256 constant P = 9_400_000_000; // 9.4e-9 ETH per token (E18 = 9.4e9)
    uint256 constant DEPTH = 10 ether; // ~$17.8k at $1,780

    function setUp() public {
        vm.warp(1_800_000_000);
        src = new MockSource();
        src.set(P, DEPTH);
        ethUsd = new MockFeed(8, 1780e8);
        // 30-minute window, poke at most every 60 s, gaps up to 10 min, 10% deviation, $10k depth, ETH price < 25 h old
        oracle = new PalisecTwapOracle(IPalisecPoolSource(address(src)), IAggregatorV3(address(ethUsd)), 1800, 60, 600, 1_000, 10_000e6, 25 hours);
    }

    function fill(uint256 minutes_, uint256 every) internal {
        for (uint256 i = 0; i <= minutes_ * 60 / every; i++) {
            oracle.poke();
            vm.warp(block.timestamp + every);
        }
        ethUsd.set(1780e8, block.timestamp);
    }

    function test_refusesUntilWindowFull() public {
        oracle.poke();
        vm.warp(block.timestamp + 300);
        oracle.poke();
        vm.expectRevert(PalisecTwapOracle.WindowIncomplete.selector);
        oracle.usdPerTokenE18();
    }

    function test_steadyPrice() public {
        fill(35, 300);
        oracle.poke();
        assertEq(oracle.twapEthPerTokenE18(), P);
        assertEq(oracle.usdPerTokenE18(), P * 1780e8 / 1e8);
    }

    function test_tooSoon() public {
        oracle.poke();
        vm.warp(block.timestamp + 59);
        vm.expectRevert(PalisecTwapOracle.TooSoon.selector);
        oracle.poke();
    }

    function test_staleObservation() public {
        fill(35, 300);
        vm.warp(block.timestamp + 601);
        vm.expectRevert(PalisecTwapOracle.StaleObservation.selector);
        oracle.twapEthPerTokenE18();
    }

    function test_gapRestartsWindow() public {
        fill(35, 300);
        vm.warp(block.timestamp + 601); // keeper missed
        oracle.poke();
        vm.expectRevert(PalisecTwapOracle.WindowIncomplete.selector);
        oracle.twapEthPerTokenE18();
    }

    /// T6: a sharp spot move is refused (deviation from the TWAP), and the TWAP itself barely moves.
    function test_T6_manipulationRefused() public {
        fill(35, 300);
        oracle.poke();
        uint256 twapBefore = oracle.twapEthPerTokenE18();
        // Attacker pumps the pool 3x and pokes in the same block.
        src.set(P * 3, DEPTH);
        vm.warp(block.timestamp + 60);
        oracle.poke();
        vm.expectRevert(abi.encodeWithSelector(PalisecTwapOracle.DeviationTooHigh.selector, P * 3, oracle.twapEthPerTokenE18()));
        oracle.usdPerTokenE18();
        // Holding the pumped price for 60 s moves the 30-minute TWAP by only ~1/30 of the jump.
        uint256 twapAfter = oracle.twapEthPerTokenE18();
        assertLt(twapAfter, twapBefore * 108 / 100);
    }

    function testFuzz_twapBoundedByObservedPrices(uint256 seed) public {
        uint256 lo = type(uint256).max;
        uint256 hi;
        for (uint256 i = 0; i < 12; i++) {
            uint256 p = bound(uint256(keccak256(abi.encode(seed, i))), 1e9, 1e10);
            src.set(p, DEPTH);
            oracle.poke();
            if (i > 0 || true) {
                lo = p < lo ? p : lo;
                hi = p > hi ? p : hi;
            }
            vm.warp(block.timestamp + 180);
        }
        oracle.poke();
        uint256 twap = oracle.twapEthPerTokenE18();
        assertGe(twap, lo);
        assertLe(twap, hi);
    }

    function test_thinPoolRefused() public {
        src.set(P, 5 ether); // ~$8.9k < $10k
        fill(35, 300);
        oracle.poke();
        vm.expectRevert();
        oracle.usdPerTokenE18();
    }

    function test_staleEthUsdRefused() public {
        fill(35, 300);
        oracle.poke();
        ethUsd.set(1780e8, block.timestamp - 25 hours - 1);
        vm.expectRevert(PalisecTwapOracle.StalePrice.selector);
        oracle.usdPerTokenE18();
    }

    function test_constructorBounds() public {
        vm.expectRevert(PalisecTwapOracle.BadParams.selector);
        new PalisecTwapOracle(IPalisecPoolSource(address(src)), IAggregatorV3(address(ethUsd)), 1800, 5, 600, 1_000, 10_000e6, 25 hours); // ring too small
        vm.expectRevert(PalisecTwapOracle.BadParams.selector);
        new PalisecTwapOracle(IPalisecPoolSource(address(src)), IAggregatorV3(address(ethUsd)), 1800, 60, 3600, 1_000, 10_000e6, 25 hours); // gap > window
    }

    /// The v4 adapter: ETH as currency0 at a known price.
    function test_v4SourceMath() public {
        MockStateView sv = new MockStateView();
        // token per ETH = 1e8 -> sqrtP = sqrt(1e8) * 2^96 = 1e4 * 2^96
        sv.set(uint160(1e4 * 2 ** 96), 1e22);
        UniswapV4PoolSource s = new UniswapV4PoolSource(sv, bytes32("pool"), true);
        (uint256 ethPerToken, uint256 depth) = s.spot();
        assertEq(ethPerToken, 1e10); // 1e-8 ETH per token
        assertEq(depth, 1e18); // L / sqrtP = 1e22 / 1e4
        UniswapV4PoolSource s1 = new UniswapV4PoolSource(sv, bytes32("pool"), false);
        (uint256 p1, uint256 d1) = s1.spot();
        assertEq(p1, 1e26); // ETH is currency1: ETH per token = sqrtP^2 / 2^192 = 1e8
        assertEq(d1, 1e26); // L * sqrtP = 1e22 * 1e4
    }
}
