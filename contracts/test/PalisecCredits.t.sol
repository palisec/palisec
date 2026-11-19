// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {PalisecCredits} from "../src/PalisecCredits.sol";
import {IAggregatorV3, IERC20, IERC20Burnable, IPalisecPriceOracle} from "../src/interfaces.sol";
import {FalseReturningERC20, MockERC20, MockFeed, MockOracle, ReentrantBuyer, RejectingTreasury, ShortBurnERC20} from "./Mocks.sol";

contract PalisecCreditsTest is Test {
    MockERC20 usdg;
    MockERC20 pal;
    MockFeed ethUsd;
    MockOracle oracle;
    PalisecCredits credits;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address buyer = makeAddr("buyer");
    address bystander = makeAddr("bystander");
    bytes32 constant ACCOUNT = keccak256("org-1");

    bytes32 constant PURCHASED = keccak256("CreditsPurchased(bytes32,address,uint8,uint256,uint256,uint256,uint256)");

    function config() internal view returns (PalisecCredits.Config memory) {
        return PalisecCredits.Config({
            admin: admin,
            treasury: treasury,
            priceUsdE6PerThousand: 5_000_000, // $5 per 1,000
            palisecDiscountBps: 2_000, // 20%
            maxPalisecUsdE6PerPurchase: 10e6,
            maxPalisecUsdE6PerAccountPerDay: 25e6,
            maxUsdE6PerPurchase: 1_000e6,
            maxPriceAge: 25 hours,
            sequencerGracePeriod: 1 hours,
            sequencerUptimeFeed: address(0)
        });
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("USDG", 6);
        pal = new MockERC20("PALISEC", 18);
        ethUsd = new MockFeed(8, 1780e8);
        oracle = new MockOracle();
        oracle.set(0.0000165e18, false); // $0.0000165 per token
        credits = new PalisecCredits(IERC20(address(usdg)), IERC20Burnable(address(pal)), IAggregatorV3(address(ethUsd)), config());
        usdg.mint(buyer, 1_000_000e6);
        pal.mint(buyer, 10_000_000_000e18);
        vm.deal(buyer, 100 ether);
        // A bystander who approved the contract must never lose anything.
        usdg.mint(bystander, 1_000e6);
        pal.mint(bystander, 1_000_000e18);
        vm.startPrank(bystander);
        usdg.approve(address(credits), type(uint256).max);
        pal.approve(address(credits), type(uint256).max);
        vm.stopPrank();
    }

    function enablePalisec() internal {
        vm.startPrank(admin);
        credits.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        credits.setPalisecPath(true);
        vm.stopPrank();
    }

    function purchasedEvent() internal returns (uint256 amountPaid, uint256 usd, uint256 creditsOut, uint256 burned) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == PURCHASED) return abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
        }
        revert("no event");
    }

    // ---------------------------------------------------------------- USDG
    function test_usdg_paysTreasuryExactly() public {
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        vm.recordLogs();
        credits.buyWithUsdg(ACCOUNT, 1_000);
        vm.stopPrank();
        (uint256 paid, uint256 usd, uint256 c, uint256 burned) = purchasedEvent();
        assertEq(usdg.balanceOf(treasury), 5e6);
        assertEq(paid, 5e6);
        assertEq(usd, 5e6);
        assertEq(c, 1_000);
        assertEq(burned, 0);
        assertEq(usdg.balanceOf(address(credits)), 0);
    }

    function test_usdg_roundsUp() public {
        // 1 credit = $0.005 = 5,000 micro-USD exactly; 3 credits = 15,000; price $5.000001 per 1,000 rounds up.
        vm.prank(admin);
        credits.setPrice(5_000_001, 2_000);
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        credits.buyWithUsdg(ACCOUNT, 1);
        vm.stopPrank();
        assertEq(usdg.balanceOf(treasury), 5_001); // ceil(5_000_001 / 1000)
    }

    function test_usdg_falseReturnReverts() public {
        FalseReturningERC20 bad = new FalseReturningERC20();
        PalisecCredits c = new PalisecCredits(IERC20(address(bad)), IERC20Burnable(address(pal)), IAggregatorV3(address(ethUsd)), config());
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.TransferFailed.selector);
        c.buyWithUsdg(ACCOUNT, 1_000);
    }

    function test_usdg_overCap() public {
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        vm.expectRevert(PalisecCredits.OverCap.selector);
        credits.buyWithUsdg(ACCOUNT, 200_001); // $1,000.005 > $1,000
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- ETH
    function test_eth_forwardsAndRefunds() public {
        uint256 cost = credits.quoteWei(1_000); // $5 at $1,780
        assertEq(cost, uint256(5e6) * 1e8 * 1e12 / 1780e8 + 1); // rounded up
        vm.recordLogs();
        vm.prank(buyer);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        (uint256 paid, uint256 usd, uint256 c,) = purchasedEvent();
        assertEq(paid, cost);
        assertEq(usd, 5e6);
        assertEq(c, 1_000);
        assertEq(treasury.balance, cost);
        assertEq(buyer.balance, 100 ether - cost);
        assertEq(address(credits).balance, 0);
    }

    function test_eth_underpaid() public {
        uint256 cost = credits.quoteWei(1_000);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(PalisecCredits.Underpaid.selector, cost, cost - 1));
        credits.buyWithEth{value: cost - 1}(ACCOUNT, 1_000);
    }

    function test_eth_stalePrice() public {
        ethUsd.set(1780e8, block.timestamp - 25 hours - 1);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.StalePrice.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
    }

    function test_eth_badAnswers() public {
        ethUsd.set(0, block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.StalePrice.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        ethUsd.set(-1, block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.StalePrice.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        ethUsd.set(1780e8, block.timestamp);
        ethUsd.setRounds(11, 10);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.StalePrice.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
    }

    function test_eth_sequencerDownAndGrace() public {
        MockFeed seq = new MockFeed(0, 1); // 1 = down
        vm.prank(admin);
        credits.setFeedSettings(25 hours, 1 hours, address(seq));
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.SequencerDown.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        seq.set(0, block.timestamp); // back up, just now
        seq.setStartedAt(block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.SequencerDown.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        vm.warp(block.timestamp + 1 hours + 1);
        ethUsd.set(1780e8, block.timestamp);
        vm.prank(buyer);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
    }

    function test_eth_reentrancyBlocked() public {
        ReentrantBuyer evil = new ReentrantBuyer(address(credits));
        vm.deal(address(evil), 1 ether);
        vm.expectRevert(PalisecCredits.TransferFailed.selector);
        evil.buy{value: 1 ether}(1_000);
        assertEq(address(credits).balance, 0);
    }

    function test_eth_rejectingTreasuryReverts() public {
        RejectingTreasury r = new RejectingTreasury();
        vm.prank(admin);
        credits.setTreasury(address(r));
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.TransferFailed.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
    }

    function test_plainEthRefused() public {
        vm.prank(buyer);
        (bool ok,) = address(credits).call{value: 1}("");
        assertFalse(ok);
    }

    // ---------------------------------------------------------------- $PALISEC
    function test_palisec_offByDefault() public {
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.PalisecPathOff.selector);
        credits.buyWithPalisec(ACCOUNT, 1_000, type(uint256).max);
    }

    function test_palisec_cannotEnableWithoutOracle() public {
        vm.prank(admin);
        vm.expectRevert(PalisecCredits.PalisecPathOff.selector);
        credits.setPalisecPath(true);
    }

    function test_palisec_burnsInSameTx() public {
        enablePalisec();
        uint256 supply = pal.totalSupply();
        vm.startPrank(buyer);
        pal.approve(address(credits), type(uint256).max);
        vm.recordLogs();
        credits.buyWithPalisec(ACCOUNT, 1_000, type(uint256).max);
        vm.stopPrank();
        (uint256 paid, uint256 usd, uint256 c, uint256 burned) = purchasedEvent();
        assertEq(usd, 4e6); // $5 - 20%
        uint256 expected = (uint256(4e6) * 1e30 - 1) / 0.0000165e18 + 1;
        assertEq(paid, expected);
        assertEq(burned, expected);
        assertEq(c, 1_000);
        assertEq(supply - pal.totalSupply(), expected);
        assertEq(pal.balanceOf(address(credits)), 0);
    }

    function test_palisec_slippage() public {
        enablePalisec();
        vm.startPrank(buyer);
        pal.approve(address(credits), type(uint256).max);
        vm.expectRevert();
        credits.buyWithPalisec(ACCOUNT, 1_000, 1);
        vm.stopPrank();
    }

    function test_palisec_caps() public {
        enablePalisec();
        vm.startPrank(buyer);
        pal.approve(address(credits), type(uint256).max);
        // per purchase: $10 after discount = 2,500 credits; 2,501 is over.
        vm.expectRevert(PalisecCredits.OverCap.selector);
        credits.buyWithPalisec(ACCOUNT, 2_501, type(uint256).max);
        credits.buyWithPalisec(ACCOUNT, 2_500, type(uint256).max); // $10
        credits.buyWithPalisec(ACCOUNT, 2_500, type(uint256).max); // $20
        vm.expectRevert(PalisecCredits.OverCap.selector);
        credits.buyWithPalisec(ACCOUNT, 1_251, type(uint256).max); // $25.004 > $25 per day
        credits.buyWithPalisec(ACCOUNT, 1_250, type(uint256).max); // $25 exactly
        vm.warp(block.timestamp + 1 days);
        credits.buyWithPalisec(ACCOUNT, 2_500, type(uint256).max); // new day
        vm.stopPrank();
    }

    function test_palisec_oracleRefusalStopsPurchase() public {
        enablePalisec();
        oracle.set(0.0000165e18, true);
        vm.startPrank(buyer);
        pal.approve(address(credits), type(uint256).max);
        vm.expectRevert(bytes("oracle refused"));
        credits.buyWithPalisec(ACCOUNT, 1_000, type(uint256).max);
        vm.stopPrank();
    }

    function test_palisec_shortBurnReverts() public {
        ShortBurnERC20 bad = new ShortBurnERC20();
        PalisecCredits c = new PalisecCredits(IERC20(address(usdg)), IERC20Burnable(address(bad)), IAggregatorV3(address(ethUsd)), config());
        vm.startPrank(admin);
        c.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        c.setPalisecPath(true);
        vm.stopPrank();
        bad.mint(buyer, 1e30);
        vm.startPrank(buyer);
        bad.approve(address(c), type(uint256).max);
        vm.expectRevert(PalisecCredits.BurnMismatch.selector);
        c.buyWithPalisec(ACCOUNT, 1_000, type(uint256).max);
        vm.stopPrank();
    }

    function test_oracleChangeSwitchesPathOff() public {
        enablePalisec();
        vm.prank(admin);
        credits.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        assertFalse(credits.palisecEnabled());
    }

    // ---------------------------------------------------------------- pause and admin
    function test_pausedBlocksEverything() public {
        enablePalisec();
        vm.prank(admin);
        credits.setPaused(true);
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        pal.approve(address(credits), type(uint256).max);
        vm.expectRevert(PalisecCredits.PurchasesPaused.selector);
        credits.buyWithUsdg(ACCOUNT, 1_000);
        vm.expectRevert(PalisecCredits.PurchasesPaused.selector);
        credits.buyWithEth{value: 1 ether}(ACCOUNT, 1_000);
        vm.expectRevert(PalisecCredits.PurchasesPaused.selector);
        credits.buyWithPalisec(ACCOUNT, 1_000, type(uint256).max);
        vm.stopPrank();
    }

    function test_onlyAdmin() public {
        vm.startPrank(buyer);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setPaused(true);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setTreasury(buyer);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setPrice(1e6, 0);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setCaps(1e6, 1e6, 1e6);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setFeedSettings(1 hours, 0, address(0));
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.setPalisecPath(false);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.proposeAdmin(buyer);
        vm.stopPrank();
    }

    function test_setterBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setPrice(99_999, 0);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setPrice(1_000_000_001, 0);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setPrice(5e6, 5_001);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setCaps(0, 1e6, 1e6);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setCaps(1_000e6 + 1, 5_000e6, 1e6);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setCaps(10e6, 9e6, 1e6);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setCaps(10e6, 5_000e6 + 1, 1e6);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setCaps(10e6, 25e6, 100_000e6 + 1);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setFeedSettings(59, 0, address(0));
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setFeedSettings(2 days + 1, 0, address(0));
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        credits.setFeedSettings(1 hours, 1 days + 1, address(0));
        vm.expectRevert(PalisecCredits.ZeroAddress.selector);
        credits.setTreasury(address(0));
        vm.stopPrank();
    }

    function test_twoStepAdmin() public {
        address next = makeAddr("next");
        vm.prank(admin);
        credits.proposeAdmin(next);
        assertEq(credits.admin(), admin);
        vm.prank(buyer);
        vm.expectRevert(PalisecCredits.NotAdmin.selector);
        credits.acceptAdmin();
        vm.prank(next);
        credits.acceptAdmin();
        assertEq(credits.admin(), next);
    }

    function test_badCredits() public {
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        vm.expectRevert(PalisecCredits.BadCredits.selector);
        credits.buyWithUsdg(ACCOUNT, 0);
        vm.expectRevert(PalisecCredits.BadCredits.selector);
        credits.buyWithUsdg(ACCOUNT, 100_000_001);
        vm.stopPrank();
    }

    function test_constructorChecksDecimals() public {
        MockERC20 wrong = new MockERC20("X", 18);
        vm.expectRevert(PalisecCredits.OutOfBounds.selector);
        new PalisecCredits(IERC20(address(wrong)), IERC20Burnable(address(pal)), IAggregatorV3(address(ethUsd)), config());
    }

    // ---------------------------------------------------------------- fuzz: amounts and prices
    function testFuzz_usdgCreditsMatchPayment(uint256 c, uint256 price) public {
        c = bound(c, 1, 200_000);
        price = bound(price, 100_000, 5_000_000);
        vm.prank(admin);
        credits.setPrice(price, 2_000);
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        uint256 before = usdg.balanceOf(treasury);
        vm.recordLogs();
        credits.buyWithUsdg(ACCOUNT, c);
        vm.stopPrank();
        (uint256 paid, uint256 usd, uint256 got,) = purchasedEvent();
        uint256 expected = (c * price + 999) / 1000;
        assertEq(paid, expected);
        assertEq(usd, expected);
        assertEq(got, c);
        assertEq(usdg.balanceOf(treasury) - before, expected);
        // Paid at least the exact price, never more than one micro-dollar over.
        assertGe(paid * 1000, c * price);
        assertLt(paid * 1000, c * price + 1000);
    }

    function testFuzz_ethCreditsMatchPayment(uint256 c, uint256 ethPrice, uint256 overpay) public {
        c = bound(c, 1, 200_000);
        ethPrice = bound(ethPrice, 100e8, 100_000e8);
        overpay = bound(overpay, 0, 10 ether);
        ethUsd.set(int256(ethPrice), block.timestamp);
        uint256 cost = credits.quoteWei(c);
        vm.deal(buyer, cost + overpay);
        vm.prank(buyer);
        credits.buyWithEth{value: cost + overpay}(ACCOUNT, c);
        assertEq(treasury.balance, cost);
        assertEq(buyer.balance, overpay);
        assertEq(address(credits).balance, 0);
        // cost covers the USD price: cost * price >= usd * 1e20 (8 decimals feed, 6 decimals usd, 18 wei)
        uint256 usd = credits.quoteUsdE6(c);
        assertGe(cost * ethPrice, usd * 1e20);
        assertLt(cost * ethPrice, usd * 1e20 + ethPrice);
    }

    function testFuzz_palisecBurnEqualsSupplyDrop(uint256 c, uint256 tokenPrice) public {
        c = bound(c, 1, 2_500);
        tokenPrice = bound(tokenPrice, 1e9, 1e18); // $1e-9 .. $1 per token
        enablePalisec();
        oracle.set(tokenPrice, false);
        uint256 supply = pal.totalSupply();
        vm.startPrank(buyer);
        pal.approve(address(credits), type(uint256).max);
        vm.recordLogs();
        credits.buyWithPalisec(ACCOUNT, c, type(uint256).max);
        vm.stopPrank();
        (uint256 paid, uint256 usd,, uint256 burned) = purchasedEvent();
        assertEq(paid, burned);
        assertEq(supply - pal.totalSupply(), burned);
        // tokens * price covers the USD owed
        assertGe(burned * tokenPrice, usd * 1e30);
        assertEq(pal.balanceOf(address(credits)), 0);
    }

    function testFuzz_pausedNothingSucceeds(uint256 c, uint8 path) public {
        c = bound(c, 1, 2_000);
        enablePalisec();
        vm.prank(admin);
        credits.setPaused(true);
        vm.startPrank(buyer);
        usdg.approve(address(credits), type(uint256).max);
        pal.approve(address(credits), type(uint256).max);
        vm.expectRevert(PalisecCredits.PurchasesPaused.selector);
        if (path % 3 == 0) credits.buyWithUsdg(ACCOUNT, c);
        else if (path % 3 == 1) credits.buyWithEth{value: 1 ether}(ACCOUNT, c);
        else credits.buyWithPalisec(ACCOUNT, c, type(uint256).max);
        vm.stopPrank();
    }
}
