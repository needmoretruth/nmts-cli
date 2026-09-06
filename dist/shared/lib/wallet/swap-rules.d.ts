/** Which way the trade runs. Every screen and every command uses these two words only. */
export type SwapDirection = "SUI_TO_WAL" | "WAL_TO_SUI";
/** Where the trade runs, on mainnet. */
export type SwapVenue = "deepbook" | "bluefin";
/**
 * The order the two venues are listed in. NOT a ranking: neither is a default and nobody
 * recommends one — at some amounts one pays more, at others the other. The order is fixed only so
 * a person finds the same venue in the same place every time.
 */
export declare const SWAP_VENUES: readonly SwapVenue[];
/** The lowest slippage allowance: 1 bps (0.01%). Zero would refuse every price movement. */
export declare const SLIPPAGE_BPS_MIN = 1;
/** The highest: 5,000 bps (50%). Above that it is not protection, it is protection switched off. */
export declare const SLIPPAGE_BPS_MAX = 5000;
/**
 * The default: 50 bps (0.5%). The two real mainnet swaps the treasury made came out 0.2% and 0.6%
 * from their quotes (treasury ledger rows 2 and 3); this sits between those measurements.
 */
export declare const SLIPPAGE_BPS_DEFAULT = 50;
/** Preset buttons. A free number beside them is mandatory — presets alone are never enough. */
export declare const SLIPPAGE_PRESETS_BPS: readonly number[];
/**
 * A typed slippage as a whole number of bps inside the usable range — clamped, not refused: a
 * person who types 99999 means "as loose as it goes". Not a number, or infinite, goes to the
 * DEFAULT rather than the ceiling: a broken input must not read as "protection at its loosest".
 */
export declare function clampSlippageBps(n: number): number;
/** Which band a slippage sits in. The warning on every surface reads this one verdict. */
export type SlippageBand = "low" | "ok" | "high";
/**
 * Too low / fine / too high. Below 10 bps the trade fails on the smallest price movement (gas
 * spent, nothing bought); above 200 bps a thin order book is handed that much for free. Both
 * edges (10 and 200) are "ok", so the 10 bps preset never warns about itself.
 */
export declare function slippageBand(bps: number): SlippageBand;
/**
 * The minimum to accept, from a quote: floor(quote × (10000 − bps) / 10000), never negative. Floor,
 * because rounding up would demand more than the quote and fail a trade that fills exactly as
 * quoted. A bps outside 0..10000 is folded to that range here; validation is `clampSlippageBps`.
 */
export declare function minOutFromQuote(quoteUnits: bigint, slippageBps: number): bigint;
/** Which band a gas budget sits in — the same three words as slippage, so one warning part serves. */
export type FeeBand = "low" | "ok" | "high";
/**
 * Too low / fine / too high, judged against a measured fee when there is one: low below 1.2× the
 * measurement (a budget cut to the measurement often falls short by the time it executes), high
 * above 10× AND above 0.05 SUI (ten times a tiny fee is still small change). With no measurement,
 * absolute bounds only: above 0.5 SUI is high, below the floor is low. A missing measurement is
 * never replaced by a plausible one.
 */
export declare function feeBand(budgetMist: bigint, estimateMist: bigint | null): FeeBand;
/**
 * How far a quote sits from the market rate, in bps, sign-free (the denominator is the market).
 * Null when either side is not a finite positive number. Unrounded — where to cut digits is the
 * surface's decision. This is what stops a thin or manipulated order book taking the money: a quote
 * on its own makes one order book the truth, and an empty one is exactly when a person loses.
 */
export declare function priceDeviationBps(impliedRate: number, marketRate: number): number | null;
/** Beyond this distance from the market rate a quote is an extreme (3%). */
export declare const DEVIATION_WARN_BPS = 300;
/** Output per unit of input, as a number for the market comparison. Null when either side is 0. */
export declare function impliedRate(outUnits: bigint, amountInUnits: bigint): number | null;
/**
 * The market rate in the DIRECTION'S OWN unit — WAL per SUI going one way, SUI per WAL the other —
 * so the two sides of the ratio are never swapped. Null unless both prices are positive numbers.
 */
export declare function marketRate(direction: SwapDirection, suiUsd: number | null | undefined, walUsd: number | null | undefined): number | null;
/**
 * The most SUI a swap may take in: balance minus the gas budget the person set, never negative.
 * Not a fixed reserve — the person chose the budget, so that exact figure is what is kept back.
 */
export declare function maxSwappableSuiMist(suiBalanceMist: bigint, gasBudgetMist: bigint): bigint;
/** One reason a swap is outside the ordinary bands. Each maps to one sentence on each surface. */
export type SwapExtreme = "lowSlippage" | "highSlippage" | "lowFee" | "highFee" | "deviation";
/**
 * Every extreme in one trade, in reading order. Empty means ordinary. A budget of null means the
 * person set none (the SDK will), so there is no fee band to judge; a deviation of null means no
 * market price was available, which is reported as unknown by the surface, never as "fine".
 */
export declare function swapExtremes(input: {
    slippageBps: number;
    budgetMist: bigint | null;
    estimateMist: bigint | null;
    deviationBps: number | null;
}): SwapExtreme[];
/**
 * A fee in base units as a rate of the amount put in, in bps with two decimals. Bluefin's quote
 * reports the fee outright (`fee_amount` + `protocol_fee`); both parts count, or the rate reads
 * smaller than what is charged. Null when nothing went in.
 */
export declare function feeRateBpsOf(feeUnits: bigint, amountInUnits: bigint): number | null;
/** One DeepBook quote row: what comes out, and what went in but was not used. */
export interface DeepbookQuoteRow {
    outUnits: bigint;
    leftoverInUnits: bigint;
}
/**
 * The three values a DeepBook quote returns are always (base side, quote side, DEEP needed); which
 * of the first two is "received" and which is "left over" depends on the direction. Base = WAL,
 * quote = SUI on the WAL_SUI book.
 */
export declare function deepbookRowFrom(direction: SwapDirection, base: bigint, quote: bigint): DeepbookQuoteRow;
/**
 * DeepBook's EFFECTIVE fee rate, measured — there is no constant to read. The same amount is
 * quoted in two modes: fee taken from the input coin (the mode used, needs no DEEP) and fee paid in
 * DEEP; the difference is what the input mode kept. ⛔ Outputs alone must not be subtracted:
 * DeepBook rounds to its lot size and each mode leaves a different remainder, so output per unit
 * ACTUALLY SPENT is compared (25 WAL measured 0.40% the naive way and 0.127% this way, matching a
 * 100 SUI trade where rounding vanishes). Integer arithmetic throughout.
 *
 * Null, never 0, when it cannot be measured — including a non-positive result, which means the
 * method broke down (the two modes walked the book to different depths), not that the fee is 0.
 * DeepBook always charges; "0%" would be a lie.
 */
export declare function measureDeepbookFeeBps(amountInUnits: bigint, inputMode: DeepbookQuoteRow, deepMode: DeepbookQuoteRow | null): number | null;
