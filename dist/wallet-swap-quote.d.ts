import type { walrusClient } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import { type SwapPair, type SwapRoute } from "./shared/lib/wallet/swap-routes.ts";
import { type SwapCoin, type SwapDirection, type SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
/** The zero address: a quote is a read, and a read needs no wallet. */
export declare const QUOTE_SENDER: string;
/** One venue's answer, now. Every field was read from the chain this moment; none is a constant. */
export interface VenueQuote {
    venue: SwapVenue;
    /** What comes out AFTER the venue's fee, in the output coin's base units. */
    outUnits: bigint;
    /** The fee this quote carries, in bps (two decimals). Null = could not be measured, not 0. */
    feeRateBps: number | null;
    /** Input that would come back unused (DeepBook rounds to its lot size). */
    leftoverInUnits: bigint;
    /** The route this answer came from — the swap is built along exactly this route. */
    route: SwapRoute;
    /** USDC the second pool of a through-USDC route would hand back unused. 0n on a direct route. */
    leftoverMidUnits: bigint;
}
/** The pools a venue has on a network, per pair. Null = none there, and nothing is guessed. */
export type VenuePools = Readonly<Record<SwapPair, string | null>>;
/** The three exact coin types of a network. ⛔ A coin is matched by this whole type, never a symbol. */
export declare function swapCoinTypes(network: Network): Readonly<Record<SwapCoin, string>>;
/** DeepBook's order books on a network. */
export declare function deepbookPools(network: Network): VenuePools;
/** The pool's two coin types, in pool order (first coin = DeepBook base = Bluefin coin_a). */
export declare function pairTypes(network: Network, pair: SwapPair): [string, string];
/** A pool's id, or a throw when this tool knows none on that network. */
export declare function poolIdOf(pools: VenuePools, pair: SwapPair, venue: SwapVenue): string;
/** The routes a venue can build for a direction with the pools it has. */
export declare function routesWithPools(venue: SwapVenue, direction: SwapDirection, pools: VenuePools): SwapRoute[];
type Client = ReturnType<typeof walrusClient>;
/** One venue's answer now. Bluefin needs its resolved binding; DeepBook needs nothing resolved. */
export declare function quoteVenue(client: Client, network: Network, venue: SwapVenue, direction: SwapDirection, amountInUnits: bigint, bluefin: {
    packageId: string;
    pools: VenuePools;
} | null): Promise<VenueQuote>;
export {};
