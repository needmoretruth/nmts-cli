import { type Network } from "../network.ts";
import { type SwapReads } from "../wallet-swap-chain.ts";
import type { SignSwap } from "../wallet-sign.ts";
/** What the site's price route says, when it says anything. Null = no reference price just now. */
export interface MarketPrices {
    suiUsd: number | null;
    walUsd: number | null;
}
export interface WalletSwapOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    yes?: boolean;
    dryRun?: boolean;
    feeCap?: string | undefined;
    /** `--to`: the coin to receive. Only ever the other coin; said so a typo cannot flip the trade. */
    to?: string | undefined;
    /** `--venue`: deepbook or bluefin. Without it, both are quoted and the run stops. */
    venue?: string | undefined;
    /** `--slippage-bps`: whole bps, clamped to the browser's range. Default 50. */
    slippageBps?: string | undefined;
    /** `--accept-extremes`: go on past the extremes gate. A person's act — refused outside mode off. */
    acceptExtremes?: boolean;
    now?: number;
    /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
    readChain?: (network: Network) => SwapReads | Promise<SwapReads>;
    readPrices?: (server: string) => Promise<MarketPrices | null>;
    sign?: SignSwap;
}
export declare function asMarketPrices(value: unknown): MarketPrices | null;
export declare function walletSwap(operands: readonly string[], options?: WalletSwapOptions): Promise<number>;
