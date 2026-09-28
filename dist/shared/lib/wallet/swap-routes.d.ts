import { type SwapCoin, type SwapDirection, type SwapVenue } from "./swap-rules.ts";
/**
 * The three pools, named FIRST_SECOND. On every pool this product uses, the first coin is
 * DeepBook's base and Bluefin's coin_a, and the pool's on-chain type is `Pool<first, second>` —
 * so the type arguments of a call are always this order, whichever way the trade runs.
 */
export type SwapPair = "WAL_SUI" | "SUI_USDC" | "WAL_USDC";
/** The two coins of each pool, first coin first. */
export declare const PAIR_COINS: Readonly<Record<SwapPair, readonly [SwapCoin, SwapCoin]>>;
/** One trade through one pool: which pool, which coin goes in, and whether that is the first coin. */
export interface SwapHop {
    pair: SwapPair;
    from: SwapCoin;
    to: SwapCoin;
    /** True when the coin going in is the pool's first coin (DeepBook: sells base; Bluefin: a2b). */
    sellsFirst: boolean;
}
/** The hop from one coin to another through the one pool that holds both. Throws for one coin twice. */
export declare function hopFor(from: SwapCoin, to: SwapCoin): SwapHop;
/**
 * How a venue gets from one coin to the other: straight through the pool that holds both, or —
 * for WAL ↔ SUI only — through USDC, two pools in ONE transaction, where the minimum is enforced
 * on the last pool and so covers the whole trade.
 */
export type SwapRoute = "direct" | "viaUsdc";
/** The pools a route trades through, in order; null when the route does not apply to the direction. */
export declare function routeHops(direction: SwapDirection, route: SwapRoute): readonly SwapHop[] | null;
/**
 * The routes a venue quotes for a direction. DeepBook quotes WAL ↔ SUI both ways: its WAL_SUI book
 * measured thin on 2026-09-28 (1,000 WAL → 14.26 SUI against about 29.1 at market, while WAL_USDC
 * then SUI_USDC gave 29.0), but below the USDC books' one-coin minimum the direct book was the
 * only one that paid anything (10 WAL → 0.28 SUI direct, 0 through USDC). Bluefin's WAL/SUI pool
 * is deep, so it trades direct only.
 */
export declare function venueRoutes(venue: SwapVenue, direction: SwapDirection): readonly SwapRoute[];
/**
 * Of one venue's route answers, the one that pays more — that route is what gets built and signed.
 * A tie goes to the direct route (one pool, one fee, fewer coins back). Null when nothing answered.
 */
export declare function pickRoute<T extends {
    route: SwapRoute;
    outUnits: bigint;
}>(answers: readonly T[]): T | null;
