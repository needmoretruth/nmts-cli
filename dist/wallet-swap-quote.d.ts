import type { walrusClient } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import { type SwapDirection, type SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
/** The zero address: a quote is a read, and a read needs no wallet. */
export declare const QUOTE_SENDER: string;
/** One venue's answer, now. Every field was read from the chain this moment; none is a constant. */
export interface VenueQuote {
    venue: SwapVenue;
    /** What comes out AFTER the venue's fee, in base units. */
    outUnits: bigint;
    /** The fee this quote carries, in bps (two decimals). Null = could not be measured, not 0. */
    feeRateBps: number | null;
    /** Input that would come back unused (DeepBook rounds to its lot size). */
    leftoverInUnits: bigint;
}
type Client = ReturnType<typeof walrusClient>;
/** One venue's answer now. Bluefin needs its resolved binding; DeepBook needs nothing resolved. */
export declare function quoteVenue(client: Client, network: Network, venue: SwapVenue, direction: SwapDirection, amountInUnits: bigint, bluefin: {
    packageId: string;
    poolId: string;
} | null): Promise<VenueQuote>;
export {};
