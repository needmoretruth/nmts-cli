/** DeepBook v3's package, per network. Read from `@mysten/deepbook-v3` 1.6.2; the mainnet value is confirmed by real trades. */
export declare const DEEPBOOK_PACKAGE_IDS: Readonly<Record<"mainnet" | "testnet", string>>;
/** Bluefin Spot's CURRENT package (mainnet only). A fallback for the browser, a name for the list. */
export declare const BLUEFIN_PACKAGE_IDS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/** DeepBook's WAL_SUI order book (base = WAL, quote = SUI). ⚠ The testnet book trades a different WAL. */
export declare const DEEPBOOK_WAL_SUI_POOLS: Readonly<Record<"mainnet" | "testnet", string>>;
/** DEEP, DeepBook's own coin — an empty coin of it is passed so the fee comes off the input coin. */
export declare const DEEP_COIN_TYPES: Readonly<Record<"mainnet" | "testnet", string>>;
/** Bluefin's UpgradeCap — where the CURRENT package is read from before any quote or swap. */
export declare const BLUEFIN_UPGRADE_CAP_IDS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/** Bluefin's GlobalConfig shared object — a swap argument, and what the version check reads. */
export declare const BLUEFIN_GLOBAL_CONFIG_IDS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/** Bluefin's WAL/SUI pool, `Pool<WAL, SUI>` (coin_a = WAL, coin_b = SUI). Pinned by address: same-pair empty pools exist. */
export declare const BLUEFIN_WAL_SUI_POOLS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/**
 * Circle's native USDC on Sui, per network: 6 decimals, symbol USDC (read with
 * `suix_getCoinMetadata` on both chains). ⛔ A coin is USDC only when its WHOLE type equals this
 * string. Anyone can publish a coin whose symbol is "USDC"; the package address is the proof.
 */
export declare const USDC_COIN_TYPES: Readonly<Record<"mainnet" | "testnet", string>>;
/** DeepBook's SUI_USDC order book (base = SUI, quote = USDC). Its on-chain type is `Pool<SUI, USDC>`. */
export declare const DEEPBOOK_SUI_USDC_POOLS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/** DeepBook's WAL_USDC order book (base = WAL, quote = USDC). Its on-chain type is `Pool<WAL, USDC>`. */
export declare const DEEPBOOK_WAL_USDC_POOLS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/**
 * Bluefin's SUI/USDC pool, `Pool<SUI, USDC>` (coin_a = SUI, coin_b = USDC). Pinned by address: the
 * deepest of the 51 same-pair pools Bluefin's `PoolCreated` events listed on 2026-09-28.
 */
export declare const BLUEFIN_SUI_USDC_POOLS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/** Bluefin's WAL/USDC pool, `Pool<WAL, USDC>` (coin_a = WAL, coin_b = USDC). The deeper of two, 2026-09-28. */
export declare const BLUEFIN_WAL_USDC_POOLS: Readonly<Record<"mainnet" | "testnet", string | null>>;
/**
 * Bluefin's sqrt-price limits, ONE STEP INSIDE the protocol's tick range (`tick_math.move`). The
 * range ends themselves abort a swap (1009) while the quote function accepts them, so a swap built
 * on the ends shows a good quote and fails on chain. Measured on mainnet, both directions,
 * 2026-08-03. A swap that puts coin_a in (a2b) passes the minimum, one that puts coin_b in the
 * maximum; the minimum-out argument is what protects the person, not this.
 */
export declare const BLUEFIN_MIN_SQRT_PRICE: bigint;
export declare const BLUEFIN_MAX_SQRT_PRICE: bigint;
