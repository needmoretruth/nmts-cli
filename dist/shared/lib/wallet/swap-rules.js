// The rules of an in-app swap between SUI and WAL — the slippage a person may set, the minimum a
// quote turns into, the gas-budget bands, the market cross-check, the venue fee arithmetic and the
// extremes gate. ⚠ PUBLISHED — copied byte-for-byte into the `nmts` command-line package; keep
// comments self-contained English.
//
// CONTRACT: every function is pure — no I/O, no side effects, no network, no dates. Slippage is in
//   bps (1 bps = 0.01%) and is a number because a person picks it; amounts are base units
//   (1e9 = one coin) and are bigint because money is never a float.
// NON-CUSTODIAL: these helpers only DECIDE the numbers a person's own wallet then signs. NMTS is
//   not a party to the trade and takes nothing from it: no fee argument, no NMTS address.
import { GAS_BUDGET_MIN_MIST } from "./send-rules.js";
/**
 * The order the two venues are listed in. NOT a ranking: neither is a default and nobody
 * recommends one — at some amounts one pays more, at others the other. The order is fixed only so
 * a person finds the same venue in the same place every time.
 */
export const SWAP_VENUES = ["deepbook", "bluefin"];
/** The lowest slippage allowance: 1 bps (0.01%). Zero would refuse every price movement. */
export const SLIPPAGE_BPS_MIN = 1;
/** The highest: 5,000 bps (50%). Above that it is not protection, it is protection switched off. */
export const SLIPPAGE_BPS_MAX = 5000;
/**
 * The default: 50 bps (0.5%). The two real mainnet swaps the treasury made came out 0.2% and 0.6%
 * from their quotes (treasury ledger rows 2 and 3); this sits between those measurements.
 */
export const SLIPPAGE_BPS_DEFAULT = 50;
/** Preset buttons. A free number beside them is mandatory — presets alone are never enough. */
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100];
/**
 * A typed slippage as a whole number of bps inside the usable range — clamped, not refused: a
 * person who types 99999 means "as loose as it goes". Not a number, or infinite, goes to the
 * DEFAULT rather than the ceiling: a broken input must not read as "protection at its loosest".
 */
export function clampSlippageBps(n) {
    if (!Number.isFinite(n))
        return SLIPPAGE_BPS_DEFAULT;
    const rounded = Math.round(n);
    return Math.min(SLIPPAGE_BPS_MAX, Math.max(SLIPPAGE_BPS_MIN, rounded));
}
/**
 * Too low / fine / too high. Below 10 bps the trade fails on the smallest price movement (gas
 * spent, nothing bought); above 200 bps a thin order book is handed that much for free. Both
 * edges (10 and 200) are "ok", so the 10 bps preset never warns about itself.
 */
export function slippageBand(bps) {
    if (bps < 10)
        return "low";
    if (bps > 200)
        return "high";
    return "ok";
}
const BPS_DENOMINATOR = 10000n;
/**
 * The minimum to accept, from a quote: floor(quote × (10000 − bps) / 10000), never negative. Floor,
 * because rounding up would demand more than the quote and fail a trade that fills exactly as
 * quoted. A bps outside 0..10000 is folded to that range here; validation is `clampSlippageBps`.
 */
export function minOutFromQuote(quoteUnits, slippageBps) {
    if (quoteUnits <= 0n)
        return 0n;
    const rounded = Number.isFinite(slippageBps) ? Math.round(slippageBps) : SLIPPAGE_BPS_DEFAULT;
    const bounded = BigInt(Math.min(10_000, Math.max(0, rounded)));
    const out = (quoteUnits * (BPS_DENOMINATOR - bounded)) / BPS_DENOMINATOR;
    return out > 0n ? out : 0n;
}
/**
 * Too low / fine / too high, judged against a measured fee when there is one: low below 1.2× the
 * measurement (a budget cut to the measurement often falls short by the time it executes), high
 * above 10× AND above 0.05 SUI (ten times a tiny fee is still small change). With no measurement,
 * absolute bounds only: above 0.5 SUI is high, below the floor is low. A missing measurement is
 * never replaced by a plausible one.
 */
export function feeBand(budgetMist, estimateMist) {
    if (estimateMist === null) {
        if (budgetMist > 500000000n)
            return "high";
        return budgetMist < GAS_BUDGET_MIN_MIST ? "low" : "ok";
    }
    if (budgetMist < (estimateMist * 12n) / 10n)
        return "low";
    if (budgetMist > estimateMist * 10n && budgetMist > 50000000n)
        return "high";
    return "ok";
}
/**
 * How far a quote sits from the market rate, in bps, sign-free (the denominator is the market).
 * Null when either side is not a finite positive number. Unrounded — where to cut digits is the
 * surface's decision. This is what stops a thin or manipulated order book taking the money: a quote
 * on its own makes one order book the truth, and an empty one is exactly when a person loses.
 */
export function priceDeviationBps(impliedRate, marketRate) {
    if (!Number.isFinite(impliedRate) || impliedRate <= 0)
        return null;
    if (!Number.isFinite(marketRate) || marketRate <= 0)
        return null;
    return (Math.abs(impliedRate - marketRate) / marketRate) * 10_000;
}
/** Beyond this distance from the market rate a quote is an extreme (3%). */
export const DEVIATION_WARN_BPS = 300;
/** Output per unit of input, as a number for the market comparison. Null when either side is 0. */
export function impliedRate(outUnits, amountInUnits) {
    if (amountInUnits <= 0n || outUnits <= 0n)
        return null;
    const r = Number(outUnits) / Number(amountInUnits);
    return Number.isFinite(r) && r > 0 ? r : null;
}
/**
 * The market rate in the DIRECTION'S OWN unit — WAL per SUI going one way, SUI per WAL the other —
 * so the two sides of the ratio are never swapped. Null unless both prices are positive numbers.
 */
export function marketRate(direction, suiUsd, walUsd) {
    if (suiUsd == null || walUsd == null || suiUsd <= 0 || walUsd <= 0)
        return null;
    if (!Number.isFinite(suiUsd) || !Number.isFinite(walUsd))
        return null;
    return direction === "SUI_TO_WAL" ? suiUsd / walUsd : walUsd / suiUsd;
}
/**
 * The most SUI a swap may take in: balance minus the gas budget the person set, never negative.
 * Not a fixed reserve — the person chose the budget, so that exact figure is what is kept back.
 */
export function maxSwappableSuiMist(suiBalanceMist, gasBudgetMist) {
    const max = suiBalanceMist - gasBudgetMist;
    return max > 0n ? max : 0n;
}
/**
 * Every extreme in one trade, in reading order. Empty means ordinary. A budget of null means the
 * person set none (the SDK will), so there is no fee band to judge; a deviation of null means no
 * market price was available, which is reported as unknown by the surface, never as "fine".
 */
export function swapExtremes(input) {
    const out = [];
    const slip = slippageBand(input.slippageBps);
    if (slip === "low")
        out.push("lowSlippage");
    if (slip === "high")
        out.push("highSlippage");
    if (input.budgetMist !== null) {
        const gas = feeBand(input.budgetMist, input.estimateMist);
        if (gas === "low")
            out.push("lowFee");
        if (gas === "high")
            out.push("highFee");
    }
    if (input.deviationBps !== null && Math.abs(input.deviationBps) > DEVIATION_WARN_BPS) {
        out.push("deviation");
    }
    return out;
}
// ── Venue fee arithmetic — what a quote's own numbers say the venue charged ────────────────────
/** Scale that keeps two decimals of a bps figure through integer arithmetic (10,000 bps × 100). */
const BPS_SCALE = 1000000n;
/**
 * A fee in base units as a rate of the amount put in, in bps with two decimals. Bluefin's quote
 * reports the fee outright (`fee_amount` + `protocol_fee`); both parts count, or the rate reads
 * smaller than what is charged. Null when nothing went in.
 */
export function feeRateBpsOf(feeUnits, amountInUnits) {
    if (amountInUnits <= 0n || feeUnits < 0n)
        return null;
    return Number((feeUnits * BPS_SCALE) / amountInUnits) / 100;
}
/**
 * The three values a DeepBook quote returns are always (base side, quote side, DEEP needed); which
 * of the first two is "received" and which is "left over" depends on the direction. Base = WAL,
 * quote = SUI on the WAL_SUI book.
 */
export function deepbookRowFrom(direction, base, quote) {
    return direction === "SUI_TO_WAL"
        ? { outUnits: base, leftoverInUnits: quote }
        : { outUnits: quote, leftoverInUnits: base };
}
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
export function measureDeepbookFeeBps(amountInUnits, inputMode, deepMode) {
    if (deepMode === null)
        return null;
    const spentInput = amountInUnits - inputMode.leftoverInUnits;
    const spentDeep = amountInUnits - deepMode.leftoverInUnits;
    if (spentInput <= 0n || spentDeep <= 0n)
        return null;
    const denominator = deepMode.outUnits * spentInput;
    if (denominator <= 0n)
        return null;
    const numerator = denominator - inputMode.outUnits * spentDeep;
    if (numerator <= 0n)
        return null;
    return Number((numerator * BPS_SCALE) / denominator) / 100;
}
