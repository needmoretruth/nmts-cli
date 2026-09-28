// The two exchange packages the wallet's activity list recognises, per network. ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ VALUES ONLY. Their provenance, what makes them stale and what notices it are written beside
//    the browser's wallet configuration, which re-exports these and is the one place to read about
//    them. This file exists so the command-line tool can name an exchange transaction with the SAME
//    addresses the browser uses, without a second copy that drifts.
/** DeepBook v3's package, per network. Read from `@mysten/deepbook-v3` 1.6.2; the mainnet value is confirmed by real trades. */
export const DEEPBOOK_PACKAGE_IDS = {
    testnet: "0xd874d2417a55bfa6479bffa06ad950fea144ef93a94cc6c49f32b03e386bbb24",
    mainnet: "0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748",
};
/** Bluefin Spot's CURRENT package (mainnet only). A fallback for the browser, a name for the list. */
export const BLUEFIN_PACKAGE_IDS = {
    testnet: null,
    mainnet: "0xd075338d105482f1527cbfd363d6413558f184dec36d9138a70261e87f486e9c",
};
// ── The rest of what a swap needs on chain, per network. Same rule: values only, provenance beside
//    the browser's wallet configuration. Null = that network has no such thing, and nothing is guessed.
/** DeepBook's WAL_SUI order book (base = WAL, quote = SUI). ⚠ The testnet book trades a different WAL. */
export const DEEPBOOK_WAL_SUI_POOLS = {
    testnet: "0x8c1c1b186c4fddab1ebd53e0895a36c1d1b3b9a77cd34e607bef49a38af0150a",
    mainnet: "0x81f5339934c83ea19dd6bcc75c52e83509629a5f71d3257428c2ce47cc94d08b",
};
/** DEEP, DeepBook's own coin — an empty coin of it is passed so the fee comes off the input coin. */
export const DEEP_COIN_TYPES = {
    testnet: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    mainnet: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
};
/** Bluefin's UpgradeCap — where the CURRENT package is read from before any quote or swap. */
export const BLUEFIN_UPGRADE_CAP_IDS = {
    testnet: null,
    mainnet: "0xd5b2d2159a78030e6f07e028eb75236693ed7f2f32fecbdc1edb32d3a2079c0d",
};
/** Bluefin's GlobalConfig shared object — a swap argument, and what the version check reads. */
export const BLUEFIN_GLOBAL_CONFIG_IDS = {
    testnet: null,
    mainnet: "0x03db251ba509a8d5d8777b6338836082335d93eecbdd09a11e190a1cff51c352",
};
/** Bluefin's WAL/SUI pool, `Pool<WAL, SUI>` (coin_a = WAL, coin_b = SUI). Pinned by address: same-pair empty pools exist. */
export const BLUEFIN_WAL_SUI_POOLS = {
    testnet: null,
    mainnet: "0xe60bc7ade245b9f35b49686dfab0a18e5ca9176d49bef1b90f60d67d06315ff0",
};
// ── USDC, and the four pools that trade it. Same rule: values only; null = none there.
/**
 * Circle's native USDC on Sui, per network: 6 decimals, symbol USDC (read with
 * `suix_getCoinMetadata` on both chains). ⛔ A coin is USDC only when its WHOLE type equals this
 * string. Anyone can publish a coin whose symbol is "USDC"; the package address is the proof.
 */
export const USDC_COIN_TYPES = {
    testnet: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    mainnet: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
};
/** DeepBook's SUI_USDC order book (base = SUI, quote = USDC). Its on-chain type is `Pool<SUI, USDC>`. */
export const DEEPBOOK_SUI_USDC_POOLS = {
    testnet: null,
    mainnet: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
};
/** DeepBook's WAL_USDC order book (base = WAL, quote = USDC). Its on-chain type is `Pool<WAL, USDC>`. */
export const DEEPBOOK_WAL_USDC_POOLS = {
    testnet: null,
    mainnet: "0x56a1c985c1f1123181d6b881714793689321ba24301b3585eec427436eb1c76d",
};
/**
 * Bluefin's SUI/USDC pool, `Pool<SUI, USDC>` (coin_a = SUI, coin_b = USDC). Pinned by address: the
 * deepest of the 51 same-pair pools Bluefin's `PoolCreated` events listed on 2026-09-28.
 */
export const BLUEFIN_SUI_USDC_POOLS = {
    testnet: null,
    mainnet: "0x15dbcac854b1fc68fc9467dbd9ab34270447aabd8cc0e04a5864d95ccb86b74a",
};
/** Bluefin's WAL/USDC pool, `Pool<WAL, USDC>` (coin_a = WAL, coin_b = USDC). The deeper of two, 2026-09-28. */
export const BLUEFIN_WAL_USDC_POOLS = {
    testnet: null,
    mainnet: "0xbcc6909d2e85c06cf9cbfe5b292da36f5bfa0f314806474bbf6a0bf9744d37ce",
};
/**
 * Bluefin's sqrt-price limits, ONE STEP INSIDE the protocol's tick range (`tick_math.move`). The
 * range ends themselves abort a swap (1009) while the quote function accepts them, so a swap built
 * on the ends shows a good quote and fails on chain. Measured on mainnet, both directions,
 * 2026-08-03. A swap that puts coin_a in (a2b) passes the minimum, one that puts coin_b in the
 * maximum; the minimum-out argument is what protects the person, not this.
 */
export const BLUEFIN_MIN_SQRT_PRICE = 4295048016n + 1n;
export const BLUEFIN_MAX_SQRT_PRICE = 79226673515401279992447579055n - 1n;
