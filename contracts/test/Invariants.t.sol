// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PalisecCredits} from "../src/PalisecCredits.sol";
import {IAggregatorV3, IERC20, IERC20Burnable, IPalisecPriceOracle} from "../src/interfaces.sol";
import {MockERC20, MockFeed, MockOracle} from "./Mocks.sol";

/// Random sequences of purchases, admin changes, price moves and time jumps, by several buyers.
contract Handler is Test {
    PalisecCredits public credits;
    MockERC20 public usdg;
    MockERC20 public pal;
    MockFeed public ethUsd;
    MockOracle public oracle;
    address public admin;
    address public treasury;
    address[3] public buyers;
    bytes32[3] public accounts = [bytes32("a"), bytes32("b"), bytes32("c")];

    // Ghost accounting
    uint256 public ghostUsdgToTreasury;
    uint256 public ghostEthToTreasury;
    uint256 public ghostBurned;
    uint256 public ghostCreditsSold;
    uint256 public ghostUsdSold;
    uint256 public pausedSuccesses;
    uint256 public overCapSuccesses;
    mapping(address => uint256) public usdgSpent;
    mapping(address => uint256) public palSpent;
    mapping(address => uint256) public ethSpent;

    constructor(PalisecCredits c, MockERC20 u, MockERC20 p, MockFeed f, MockOracle o, address a, address t) {
        credits = c;
        usdg = u;
        pal = p;
        ethUsd = f;
        oracle = o;
        admin = a;
        treasury = t;
        for (uint256 i = 0; i < 3; i++) {
            buyers[i] = address(uint160(0xB0B0 + i));
            u.mint(buyers[i], 1e15);
            p.mint(buyers[i], 1e36);
            vm.deal(buyers[i], 1e24);
            vm.startPrank(buyers[i]);
            u.approve(address(c), type(uint256).max);
            p.approve(address(c), type(uint256).max);
            vm.stopPrank();
        }
    }

    function buyUsdg(uint256 who, uint256 n) external {
        who %= 3;
        n = bound(n, 1, 300_000);
        bool wasPaused = credits.paused();
        uint256 usd = credits.quoteUsdE6(n);
        vm.prank(buyers[who]);
        try credits.buyWithUsdg(accounts[who], n) {
            if (wasPaused) pausedSuccesses++;
            if (usd > credits.maxUsdE6PerPurchase()) overCapSuccesses++;
            ghostUsdgToTreasury += usd;
            usdgSpent[buyers[who]] += usd;
            ghostCreditsSold += n;
            ghostUsdSold += usd;
        } catch {}
    }

    function buyEth(uint256 who, uint256 n, uint256 extra) external {
        who %= 3;
        n = bound(n, 1, 300_000);
        extra = bound(extra, 0, 1 ether);
        bool wasPaused = credits.paused();
        uint256 cost;
        try credits.quoteWei(n) returns (uint256 q) {
            cost = q;
        } catch {
            return;
        }
        uint256 usd = credits.quoteUsdE6(n);
        vm.prank(buyers[who]);
        try credits.buyWithEth{value: cost + extra}(accounts[who], n) {
            if (wasPaused) pausedSuccesses++;
            if (usd > credits.maxUsdE6PerPurchase()) overCapSuccesses++;
            ghostEthToTreasury += cost;
            ethSpent[buyers[who]] += cost;
            ghostCreditsSold += n;
            ghostUsdSold += usd;
        } catch {}
    }

    function buyPalisec(uint256 who, uint256 n) external {
        who %= 3;
        n = bound(n, 1, 5_000);
        bool wasPaused = credits.paused();
        uint256 usd = credits.quotePalisecUsdE6(n);
        uint256 supply = pal.totalSupply();
        uint256 bal = pal.balanceOf(buyers[who]);
        vm.prank(buyers[who]);
        try credits.buyWithPalisec(accounts[who], n, type(uint256).max) {
            if (wasPaused) pausedSuccesses++;
            if (usd > credits.maxPalisecUsdE6PerPurchase()) overCapSuccesses++;
            uint256 burned = supply - pal.totalSupply();
            assertEq(bal - pal.balanceOf(buyers[who]), burned, "burn came from the buyer");
            ghostBurned += burned;
            palSpent[buyers[who]] += burned;
            ghostCreditsSold += n;
        } catch {}
    }

    function adminPause(bool p) external {
        vm.prank(admin);
        credits.setPaused(p);
    }

    function adminPalisec(bool on) external {
        vm.prank(admin);
        credits.setPalisecPath(on);
    }

    function adminPrice(uint256 price, uint16 discount) external {
        price = bound(price, 100_000, 1_000_000_000);
        discount = uint16(bound(discount, 0, 5_000));
        vm.prank(admin);
        credits.setPrice(price, discount);
    }

    function adminCaps(uint256 perPurchase, uint256 perDay, uint256 usd) external {
        perPurchase = bound(perPurchase, 1, 1_000e6);
        perDay = bound(perDay, perPurchase, 5_000e6);
        usd = bound(usd, 1, 100_000e6);
        vm.prank(admin);
        credits.setCaps(perPurchase, perDay, usd);
    }

    function movePrices(uint256 eth, uint256 token) external {
        ethUsd.set(int256(bound(eth, 100e8, 100_000e8)), block.timestamp);
        oracle.set(bound(token, 1e9, 1e18), false);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        ethUsd.set(ethUsd.answer(), block.timestamp);
    }
}

contract InvariantsTest is StdInvariant, Test {
    PalisecCredits credits;
    MockERC20 usdg;
    MockERC20 pal;
    Handler handler;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address bystander = makeAddr("bystander");
    uint256 constant BYSTANDER_USDG = 1_000e6;
    uint256 constant BYSTANDER_PAL = 1_000_000e18;
    uint256 constant BYSTANDER_ETH = 5 ether;
    uint256 initialSupply;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("USDG", 6);
        pal = new MockERC20("PALISEC", 18);
        MockFeed ethUsd = new MockFeed(8, 1780e8);
        MockOracle oracle = new MockOracle();
        oracle.set(0.0000165e18, false);
        credits = new PalisecCredits(
            IERC20(address(usdg)),
            IERC20Burnable(address(pal)),
            IAggregatorV3(address(ethUsd)),
            PalisecCredits.Config(admin, treasury, 5_000_000, 2_000, 10e6, 25e6, 1_000e6, 25 hours, 1 hours, address(0))
        );
        vm.prank(admin);
        credits.setPalisecOracle(IPalisecPriceOracle(address(oracle)));
        handler = new Handler(credits, usdg, pal, ethUsd, oracle, admin, treasury);
        // A bystander who approved everything and holds funds: nothing may ever move them.
        usdg.mint(bystander, BYSTANDER_USDG);
        pal.mint(bystander, BYSTANDER_PAL);
        vm.deal(bystander, BYSTANDER_ETH);
        vm.startPrank(bystander);
        usdg.approve(address(credits), type(uint256).max);
        pal.approve(address(credits), type(uint256).max);
        vm.stopPrank();
        initialSupply = pal.totalSupply();
        targetContract(address(handler));
    }

    /// The contract never holds funds after any call.
    function invariant_holdsNoFunds() public view {
        assertEq(address(credits).balance, 0);
        assertEq(usdg.balanceOf(address(credits)), 0);
        assertEq(pal.balanceOf(address(credits)), 0);
    }

    /// Nobody's funds move except the buyer's own payment.
    function invariant_bystanderUntouched() public view {
        assertEq(usdg.balanceOf(bystander), BYSTANDER_USDG);
        assertEq(pal.balanceOf(bystander), BYSTANDER_PAL);
        assertEq(bystander.balance, BYSTANDER_ETH);
    }

    /// Money in equals money out: the treasury got exactly what buyers paid; burns equal the supply drop.
    function invariant_accounting() public view {
        assertEq(usdg.balanceOf(treasury), handler.ghostUsdgToTreasury());
        assertEq(treasury.balance, handler.ghostEthToTreasury());
        assertEq(initialSupply - pal.totalSupply(), handler.ghostBurned());
    }

    /// Paused means no purchase succeeded; no purchase above a cap succeeded.
    function invariant_pauseAndCaps() public view {
        assertEq(handler.pausedSuccesses(), 0);
        assertEq(handler.overCapSuccesses(), 0);
    }

    /// The daily $PALISEC cap per account is never exceeded.
    function invariant_dailyCap() public view {
        uint256 day = block.timestamp / 1 days;
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 d = day > 3 ? day - 3 : 0; d <= day; d++) {
                assertLe(credits.palisecSpentUsdE6(handler.accounts(i), d), credits.MAX_PALISEC_USD_E6_PER_DAY());
            }
        }
    }
}
