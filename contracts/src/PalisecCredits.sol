// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3, IERC20, IERC20Burnable, IPalisecPriceOracle} from "./interfaces.sol";

/**
 * @title PalisecCredits
 * @notice Sells Palisec decision credits, priced in USD, for USDG, ETH or $PALISEC.
 *
 *  - The contract never holds funds: USDG and ETH go straight to the treasury in the same call, any
 *    ETH overpayment is refunded, and $PALISEC is burned from the buyer with `burnFrom` (it lowers
 *    the token's total supply). There is no withdraw function and no way to move anyone's tokens
 *    except the buyer's own payment.
 *  - Credits are recorded off chain by Palisec from the `CreditsPurchased` event. `account` is an
 *    opaque per-organization purchase ID shown in the Palisec console.
 *  - Not upgradeable. The admin (a company-controlled wallet) can pause, switch the $PALISEC path on
 *    or off, and change prices, caps, the treasury, the price oracle and the sequencer feed, each
 *    within hard-coded bounds. The $PALISEC path starts switched off.
 */
contract PalisecCredits {
    // ---------------------------------------------------------------- assets and feeds
    IERC20 public immutable usdg; // 6 decimals
    IERC20Burnable public immutable palisec; // 18 decimals
    IAggregatorV3 public immutable ethUsdFeed; // Chainlink ETH/USD

    uint8 private immutable ethUsdDecimals;

    enum Asset {
        USDG,
        ETH,
        PALISEC
    }

    // ---------------------------------------------------------------- configuration
    address public admin;
    address public pendingAdmin;
    address public treasury;
    bool public paused;
    bool public palisecEnabled;
    IPalisecPriceOracle public palisecOracle; // address(0) until the token has a TWAP
    IAggregatorV3 public sequencerUptimeFeed; // address(0) when the chain has none

    /// USD price of 1,000 credits, 6 decimals ($5 = 5_000_000).
    uint256 public priceUsdE6PerThousand;
    /// Discount when paying in $PALISEC, basis points (20% = 2_000).
    uint16 public palisecDiscountBps;
    /// Caps on the $PALISEC path, in USD (6 decimals).
    uint256 public maxPalisecUsdE6PerPurchase;
    uint256 public maxPalisecUsdE6PerAccountPerDay;
    /// Cap on a single USDG or ETH purchase, in USD (6 decimals).
    uint256 public maxUsdE6PerPurchase;
    /// Oldest accepted ETH/USD answer, seconds.
    uint32 public maxPriceAge;
    /// Seconds after the sequencer comes back before prices are trusted again.
    uint32 public sequencerGracePeriod;

    /// USD (6 decimals) of $PALISEC spent per account per UTC day.
    mapping(bytes32 account => mapping(uint256 day => uint256 usdE6)) public palisecSpentUsdE6;

    // ---------------------------------------------------------------- hard bounds on admin setters
    uint256 public constant MIN_PRICE_USD_E6_PER_THOUSAND = 100_000; // $0.10
    uint256 public constant MAX_PRICE_USD_E6_PER_THOUSAND = 1_000_000_000; // $1,000
    uint16 public constant MAX_DISCOUNT_BPS = 5_000; // 50%
    uint256 public constant MAX_PALISEC_USD_E6_PER_PURCHASE = 1_000e6; // $1,000
    uint256 public constant MAX_PALISEC_USD_E6_PER_DAY = 5_000e6; // $5,000
    uint256 public constant MAX_USD_E6_PER_PURCHASE = 100_000e6; // $100,000
    uint32 public constant MIN_PRICE_AGE = 60;
    uint32 public constant MAX_PRICE_AGE = 2 days;
    uint32 public constant MAX_SEQUENCER_GRACE = 1 days;
    uint256 public constant MAX_CREDITS_PER_PURCHASE = 100_000_000;

    uint256 private locked = 1;

    // ---------------------------------------------------------------- events
    event CreditsPurchased(
        bytes32 indexed account, address indexed payer, Asset indexed asset, uint256 amountPaid, uint256 usdValueE6, uint256 credits, uint256 burned
    );
    event Paused(bool paused);
    event PalisecPathSet(bool enabled);
    event PriceSet(uint256 priceUsdE6PerThousand, uint16 palisecDiscountBps);
    event CapsSet(uint256 maxPalisecUsdE6PerPurchase, uint256 maxPalisecUsdE6PerAccountPerDay, uint256 maxUsdE6PerPurchase);
    event FeedSettingsSet(uint32 maxPriceAge, uint32 sequencerGracePeriod, address sequencerUptimeFeed);
    event PalisecOracleSet(address oracle);
    event TreasurySet(address treasury);
    event AdminProposed(address pendingAdmin);
    event AdminTransferred(address admin);

    // ---------------------------------------------------------------- errors
    error NotAdmin();
    error PurchasesPaused();
    error PalisecPathOff();
    error ZeroAddress();
    error BadCredits();
    error OutOfBounds();
    error OverCap();
    error StalePrice();
    error SequencerDown();
    error Underpaid(uint256 required, uint256 sent);
    error SlippageExceeded(uint256 tokens, uint256 maxTokens);
    error TransferFailed();
    error BurnMismatch();
    error Reentrancy();

    struct Config {
        address admin;
        address treasury;
        uint256 priceUsdE6PerThousand;
        uint16 palisecDiscountBps;
        uint256 maxPalisecUsdE6PerPurchase;
        uint256 maxPalisecUsdE6PerAccountPerDay;
        uint256 maxUsdE6PerPurchase;
        uint32 maxPriceAge;
        uint32 sequencerGracePeriod;
        address sequencerUptimeFeed;
    }

    constructor(IERC20 usdg_, IERC20Burnable palisec_, IAggregatorV3 ethUsdFeed_, Config memory c) {
        if (address(usdg_) == address(0) || address(palisec_) == address(0) || address(ethUsdFeed_) == address(0)) revert ZeroAddress();
        if (c.admin == address(0) || c.treasury == address(0)) revert ZeroAddress();
        if (usdg_.decimals() != 6 || palisec_.decimals() != 18) revert OutOfBounds();
        usdg = usdg_;
        palisec = palisec_;
        ethUsdFeed = ethUsdFeed_;
        ethUsdDecimals = ethUsdFeed_.decimals();
        if (ethUsdDecimals > 18) revert OutOfBounds();
        admin = c.admin;
        treasury = c.treasury;
        _setPrice(c.priceUsdE6PerThousand, c.palisecDiscountBps);
        _setCaps(c.maxPalisecUsdE6PerPurchase, c.maxPalisecUsdE6PerAccountPerDay, c.maxUsdE6PerPurchase);
        _setFeedSettings(c.maxPriceAge, c.sequencerGracePeriod, c.sequencerUptimeFeed);
        emit AdminTransferred(c.admin);
        emit TreasurySet(c.treasury);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    modifier whenOpen() {
        if (paused) revert PurchasesPaused();
        _;
    }

    // ---------------------------------------------------------------- quotes
    /// USD (6 decimals) for `credits`, rounded up.
    function quoteUsdE6(uint256 credits) public view returns (uint256) {
        return _ceilDiv(credits * priceUsdE6PerThousand, 1_000);
    }

    /// Wei for `credits` at the current ETH/USD price, rounded up. Reverts if the price is stale or the sequencer is down.
    function quoteWei(uint256 credits) public view returns (uint256) {
        return _usdE6ToWei(quoteUsdE6(credits), _ethUsdPrice());
    }

    /// USD after the $PALISEC discount, rounded up.
    function quotePalisecUsdE6(uint256 credits) public view returns (uint256) {
        return _ceilDiv(quoteUsdE6(credits) * (10_000 - palisecDiscountBps), 10_000);
    }

    // ---------------------------------------------------------------- purchases
    /// Pays in USDG: `transferFrom` the buyer straight to the treasury.
    function buyWithUsdg(bytes32 account, uint256 credits) external nonReentrant whenOpen {
        _checkCredits(credits);
        uint256 usd = quoteUsdE6(credits);
        if (usd > maxUsdE6PerPurchase) revert OverCap();
        emit CreditsPurchased(account, msg.sender, Asset.USDG, usd, usd, credits, 0);
        _safeTransferFrom(usdg, msg.sender, treasury, usd);
    }

    /// Pays in ETH at the Chainlink ETH/USD price; forwards the price to the treasury and refunds the rest.
    function buyWithEth(bytes32 account, uint256 credits) external payable nonReentrant whenOpen {
        _checkCredits(credits);
        uint256 usd = quoteUsdE6(credits);
        if (usd > maxUsdE6PerPurchase) revert OverCap();
        uint256 cost = _usdE6ToWei(usd, _ethUsdPrice());
        if (msg.value < cost) revert Underpaid(cost, msg.value);
        emit CreditsPurchased(account, msg.sender, Asset.ETH, cost, usd, credits, 0);
        _sendEth(treasury, cost);
        if (msg.value > cost) _sendEth(msg.sender, msg.value - cost);
    }

    /// Pays in $PALISEC at the oracle's time-weighted price, minus the discount; the tokens are burned.
    /// The buyer approves this contract first. `maxTokens` protects the buyer from price movement.
    function buyWithPalisec(bytes32 account, uint256 credits, uint256 maxTokens) external nonReentrant whenOpen {
        if (!palisecEnabled || address(palisecOracle) == address(0)) revert PalisecPathOff();
        _checkCredits(credits);
        uint256 usd = quotePalisecUsdE6(credits);
        if (usd > maxPalisecUsdE6PerPurchase) revert OverCap();
        uint256 day = block.timestamp / 1 days;
        uint256 spent = palisecSpentUsdE6[account][day] + usd;
        if (spent > maxPalisecUsdE6PerAccountPerDay) revert OverCap();
        palisecSpentUsdE6[account][day] = spent;

        // Same sequencer rule as the other paths (the oracle checks ETH/USD freshness itself).
        _ethUsdPrice();
        // The oracle refuses (reverts) when its window is incomplete, the pool is thin or spot is too far from the TWAP.
        uint256 usdPerTokenE18 = palisecOracle.usdPerTokenE18();
        if (usdPerTokenE18 == 0) revert StalePrice();
        // tokens (18 decimals) = usd (6) * 1e12 * 1e18 / usdPerToken (18), rounded up
        uint256 tokens = _ceilDiv(usd * 1e30, usdPerTokenE18);
        if (tokens > maxTokens) revert SlippageExceeded(tokens, maxTokens);

        emit CreditsPurchased(account, msg.sender, Asset.PALISEC, tokens, usd, credits, tokens);
        uint256 supplyBefore = palisec.totalSupply();
        palisec.burnFrom(msg.sender, tokens);
        if (supplyBefore - palisec.totalSupply() != tokens) revert BurnMismatch();
    }

    // ---------------------------------------------------------------- admin
    function setPaused(bool p) external onlyAdmin {
        paused = p;
        emit Paused(p);
    }

    function setPalisecPath(bool enabled) external onlyAdmin {
        if (enabled && address(palisecOracle) == address(0)) revert PalisecPathOff();
        palisecEnabled = enabled;
        emit PalisecPathSet(enabled);
    }

    function setPalisecOracle(IPalisecPriceOracle oracle) external onlyAdmin {
        // Changing the price source always switches the $PALISEC path off; switching it on is a separate step.
        palisecOracle = oracle;
        palisecEnabled = false;
        emit PalisecOracleSet(address(oracle));
        emit PalisecPathSet(false);
    }

    function setPrice(uint256 priceUsdE6PerThousand_, uint16 palisecDiscountBps_) external onlyAdmin {
        _setPrice(priceUsdE6PerThousand_, palisecDiscountBps_);
    }

    function setCaps(uint256 perPurchase, uint256 perAccountPerDay, uint256 usdPerPurchase) external onlyAdmin {
        _setCaps(perPurchase, perAccountPerDay, usdPerPurchase);
    }

    function setFeedSettings(uint32 maxPriceAge_, uint32 grace, address sequencerFeed) external onlyAdmin {
        _setFeedSettings(maxPriceAge_, grace, sequencerFeed);
    }

    function setTreasury(address treasury_) external onlyAdmin {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// Two-step admin transfer: the new admin must accept.
    function proposeAdmin(address next) external onlyAdmin {
        pendingAdmin = next;
        emit AdminProposed(next);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin || msg.sender == address(0)) revert NotAdmin();
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(msg.sender);
    }

    /// Plain ETH transfers are refused: ETH only arrives with a purchase, and leaves in the same call.
    receive() external payable {
        revert TransferFailed();
    }

    // ---------------------------------------------------------------- internals
    function _setPrice(uint256 p, uint16 d) private {
        if (p < MIN_PRICE_USD_E6_PER_THOUSAND || p > MAX_PRICE_USD_E6_PER_THOUSAND || d > MAX_DISCOUNT_BPS) revert OutOfBounds();
        priceUsdE6PerThousand = p;
        palisecDiscountBps = d;
        emit PriceSet(p, d);
    }

    function _setCaps(uint256 perPurchase, uint256 perDay, uint256 usdPerPurchase) private {
        if (perPurchase == 0 || perPurchase > MAX_PALISEC_USD_E6_PER_PURCHASE) revert OutOfBounds();
        if (perDay < perPurchase || perDay > MAX_PALISEC_USD_E6_PER_DAY) revert OutOfBounds();
        if (usdPerPurchase == 0 || usdPerPurchase > MAX_USD_E6_PER_PURCHASE) revert OutOfBounds();
        maxPalisecUsdE6PerPurchase = perPurchase;
        maxPalisecUsdE6PerAccountPerDay = perDay;
        maxUsdE6PerPurchase = usdPerPurchase;
        emit CapsSet(perPurchase, perDay, usdPerPurchase);
    }

    function _setFeedSettings(uint32 age, uint32 grace, address sequencerFeed) private {
        if (age < MIN_PRICE_AGE || age > MAX_PRICE_AGE || grace > MAX_SEQUENCER_GRACE) revert OutOfBounds();
        maxPriceAge = age;
        sequencerGracePeriod = grace;
        sequencerUptimeFeed = IAggregatorV3(sequencerFeed);
        emit FeedSettingsSet(age, grace, sequencerFeed);
    }

    function _checkCredits(uint256 credits) private pure {
        if (credits == 0 || credits > MAX_CREDITS_PER_PURCHASE) revert BadCredits();
    }

    /// ETH/USD answer, after the sequencer and staleness checks.
    function _ethUsdPrice() private view returns (uint256) {
        IAggregatorV3 seq = sequencerUptimeFeed;
        if (address(seq) != address(0)) {
            (, int256 status, uint256 startedAt,,) = seq.latestRoundData();
            // 0 = up, 1 = down. After an outage, wait out the grace period.
            if (status != 0) revert SequencerDown();
            if (block.timestamp - startedAt <= sequencerGracePeriod) revert SequencerDown();
        }
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert StalePrice();
        if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        if (answeredInRound < roundId) revert StalePrice();
        return uint256(answer);
    }

    /// wei = usdE6 * 10^feedDecimals * 1e18 / (price * 1e6), rounded up.
    function _usdE6ToWei(uint256 usdE6, uint256 price) private view returns (uint256) {
        return _ceilDiv(usdE6 * (10 ** ethUsdDecimals) * 1e12, price);
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || (data.length == 0 && address(token).code.length == 0)) revert TransferFailed();
    }
}
