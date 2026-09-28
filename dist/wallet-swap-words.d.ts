import type { Network } from "./network.ts";
import { type SwapCoin, type SwapExtreme, type SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
import { type VenueQuote } from "./wallet-swap-quote.ts";
/** What the site's price route says, when it says anything. Null = no reference price just now. */
export interface MarketPrices {
    suiUsd: number | null;
    walUsd: number | null;
    /** Absent from an older site; then the USDC directions are "uncompared", never assumed at 1. */
    usdcUsd?: number | null;
}
export declare const EXTREME_WORDS: Record<SwapExtreme, string>;
export declare const USAGE = "`nmts wallet swap <SUI|WAL|USDC> <amount|max> --to <SUI|WAL|USDC> --venue deepbook|bluefin`";
/**
 * A coin named on the command line: a symbol, or a full coin type. A symbol answers at once; a full
 * type is kept as written and matched against the network's exact types once the network is known.
 */
export type CoinWord = {
    coin: SwapCoin;
} | {
    coinType: string;
};
export declare function coinWordOf(raw: string | undefined, what: string): CoinWord;
/** The coin a word names on this network. ⛔ A full type must equal one of the three EXACT types. */
export declare function resolveCoin(word: CoinWord, network: Network): SwapCoin;
/** An amount of one coin, exactly, in that coin's own decimals (USDC keeps 6, SUI and WAL 9). */
export declare function amountOf(coin: SwapCoin, units: bigint): string;
export declare function pct(bps: number): string;
export declare function asMarketPrices(value: unknown): MarketPrices | null;
export declare function venueName(venue: SwapVenue | "exchange"): string;
export declare function quoteLine(q: VenueQuote, outCoin: SwapCoin, inCoin: SwapCoin): string;
