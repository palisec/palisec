// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {PalisecCredits} from "../src/PalisecCredits.sol";
import {PalisecTwapOracle} from "../src/PalisecTwapOracle.sol";
import {PonsCurveSource, IPonsCurve} from "../src/PoolSources.sol";
import {IAggregatorV3, IERC20, IERC20Burnable, IPalisecPoolSource, IPalisecPriceOracle} from "../src/interfaces.sol";

/// Against Robinhood Chain mainnet state: real USDG, real Chainlink ETH/USD, real $PALISEC and its Pons curve.
/// FORK=1 forge test --match-contract Fork
contract ForkTest is Test {
    IERC20 constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    IERC20Burnable constant PALISEC = IERC20Burnable(0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB);
    IAggregatorV3 constant ETH_USD = IAggregatorV3(0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9);
    address constant CURVE = 0x9f7383a2fcb30124A203D359e7a403F750a56501;
    /// The largest PALISEC holder after the curve; only used as a source of test tokens on the fork.
    address constant HOLDER = 0xfD178447239ab1a9219364A44Eb8Bb8BDb77Be6B;

    PalisecCredits credits;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address buyer = makeAddr("buyer");
    bool skipFork;

    function setUp() public {
        if (vm.envOr("FORK", uint256(0)) != 1) {
            skipFork = true;
            return;
        }
        vm.createSelectFork("mainnet");
        credits = new PalisecCredits(
            USDG,
            PALISEC,
            ETH_USD,
            PalisecCredits.Config(admin, treasury, 5_000_000, 2_000, 10e6, 25e6, 1_000e6, 25 hours, 1 hours, address(0))
        );
    }

    function test_fork_realFeedQuote() public {
        if (skipFork) return;
        (, int256 answer,, uint256 updatedAt,) = ETH_USD.latestRoundData();
        emit log_named_int("ETH/USD (8 decimals)", answer);
        emit log_named_uint("updated at", updatedAt);
        uint256 w = credits.quoteWei(1_000);
        emit log_named_uint("wei for 1,000 credits ($5)", w);
        assertApproxEqRel(w * uint256(answer), 5e6 * 1e20, 1e12);
    }

    function test_fork_usdgPurchase() public {
        if (skipFork) return;
        deal(address(USDG), buyer, 100e6);
        vm.startPrank(buyer);
        USDG.approve(address(credits), type(uint256).max);
        credits.buyWithUsdg(bytes32("fork-org"), 2_000);
        vm.stopPrank();
        assertEq(USDG.balanceOf(treasury), 10e6);
        assertEq(USDG.balanceOf(address(credits)), 0);
    }

    function test_fork_ethPurchase() public {
        if (skipFork) return;
        vm.deal(buyer, 1 ether);
        uint256 cost = credits.quoteWei(1_000);
        vm.prank(buyer);
        credits.buyWithEth{value: 1 ether}(bytes32("fork-org"), 1_000);
        assertEq(treasury.balance, cost);
        assertEq(buyer.balance, 1 ether - cost);
        assertEq(address(credits).balance, 0);
    }

    /// The real curve is ~$4k deep: an oracle with the approved $10k floor refuses to price it.
    function test_fork_realCurveTooThin() public {
        if (skipFork) return;
        PonsCurveSource src = new PonsCurveSource(IPonsCurve(CURVE));
        (uint256 p, uint256 depth) = src.spot();
        emit log_named_uint("curve wei per token", p);
        emit log_named_uint("curve ETH depth (wei)", depth);
        PalisecTwapOracle oracle = new PalisecTwapOracle(src, ETH_USD, 1800, 60, 600, 1_000, 10_000e6, 25 hours);
        _fill(oracle);
        vm.expectRevert();
        oracle.usdPerTokenE18();
    }

    /// Full $PALISEC path on real state with a test floor of $1k: the real token's supply drops by exactly the burn.
    function test_fork_palisecBurnOnRealToken() public {
        if (skipFork) return;
        PonsCurveSource src = new PonsCurveSource(IPonsCurve(CURVE));
        PalisecTwapOracle oracle = new PalisecTwapOracle(src, ETH_USD, 1800, 60, 600, 1_000, 1_000e6, 25 hours);
        _fill(oracle);
        vm.startPrank(admin);
        credits.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        credits.setPalisecPath(true);
        vm.stopPrank();
        vm.prank(HOLDER);
        PALISEC.transfer(buyer, 10_000_000e18);
        uint256 supply = PALISEC.totalSupply();
        vm.startPrank(buyer);
        PALISEC.approve(address(credits), type(uint256).max);
        vm.recordLogs();
        credits.buyWithPalisec(bytes32("fork-org"), 1_000, type(uint256).max);
        vm.stopPrank();
        uint256 burned = supply - PALISEC.totalSupply();
        emit log_named_uint("PALISEC burned for 1,000 credits ($4 after discount)", burned);
        assertGt(burned, 0);
        assertEq(PALISEC.balanceOf(address(credits)), 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(credits)) {
                (,,, uint256 b) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                assertEq(b, burned);
                seen = true;
            }
        }
        assertTrue(seen);
    }

    /// T6 on real state: the curve's price triples in one block (simulated with a mocked read) and the purchase is refused.
    function test_fork_T6_spikeRefused() public {
        if (skipFork) return;
        PonsCurveSource src = new PonsCurveSource(IPonsCurve(CURVE));
        PalisecTwapOracle oracle = new PalisecTwapOracle(src, ETH_USD, 1800, 60, 600, 1_000, 1_000e6, 25 hours);
        _fill(oracle);
        (uint256 e, uint256 t) = IPonsCurve(CURVE).getReserves();
        vm.mockCall(CURVE, abi.encodeWithSelector(IPonsCurve.getReserves.selector), abi.encode(e * 3, t));
        vm.expectRevert();
        oracle.usdPerTokenE18();
    }

    function _fill(PalisecTwapOracle oracle) internal {
        for (uint256 i = 0; i < 8; i++) {
            oracle.poke();
            vm.warp(block.timestamp + 300);
        }
        oracle.poke();
        // Keep the real Chainlink answer "fresh" after the warps (its heartbeat is 24 h; we moved 40 minutes).
        (uint80 r, int256 a, uint256 s, uint256 u, uint80 ar) = ETH_USD.latestRoundData();
        if (block.timestamp - u > 25 hours) vm.mockCall(address(ETH_USD), abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), abi.encode(r, a, s, block.timestamp, ar));
    }
}
