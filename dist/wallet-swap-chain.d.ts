import { Transaction } from "@mysten/sui/transactions";
import type { Network } from "./network.ts";
import type { SwapDirection, SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
import { type WalletBalances } from "./wallet.ts";
import { type VenueQuote } from "./wallet-swap-quote.ts";
/** Where a swap runs: one of the two mainnet venues, or the official testnet facility. */
export type SwapRail = SwapVenue | "exchange";
/** Bluefin's addresses: the package PINNED in this release, confirmed on chain before it is used. */
export interface BluefinBinding {
    packageId: string;
    globalConfigId: string;
    poolId: string;
}
/** The testnet facility: its object, the package its type names, and its rate (WAL per SUI, as a fraction). */
export interface ExchangeFacility {
    objectId: string;
    packageId: string;
    rateWal: bigint;
    rateSui: bigint;
}
export interface SwapShape {
    venue: SwapRail;
    direction: SwapDirection;
    amountInUnits: bigint;
    /** The least to accept, or the chain refuses the swap. The facility has no such argument: 0n. */
    minOutUnits: bigint;
    /** A gas ceiling, or undefined to let the SDK set one from its own dry run. */
    gasBudgetMist?: bigint | undefined;
    /** Present exactly when `venue` is bluefin: the signature uses the package the quote used. */
    bluefin?: BluefinBinding | undefined;
    /** Present exactly when `venue` is exchange. */
    exchange?: ExchangeFacility | undefined;
}
/** The rails a network has. Testnet's DeepBook book trades a different WAL, and Bluefin has none. */
export declare function railsFor(network: Network): readonly SwapRail[];
export declare function swapTransaction(input: SwapShape & {
    network: Network;
    sender: string;
}): Transaction;
/** What `commands/wallet-swap.ts` reads before it prints a review. */
export interface SwapReads {
    readWallet(address: string): Promise<WalletBalances>;
    /** Bluefin's pinned package, version-checked. Throws when the chain refuses that package. */
    resolveBluefin(): Promise<BluefinBinding>;
    /** The testnet facility and its rate. Throws off testnet, or when the object cannot be read. */
    readExchange(): Promise<ExchangeFacility>;
    /** One venue's answer now. Throws when it does not answer — never a number in its place. */
    quote(venue: SwapVenue, direction: SwapDirection, amountInUnits: bigint, bluefin: BluefinBinding | null): Promise<VenueQuote>;
    /** The fee in MIST measured by dry-running this exact swap, or null when it could not be. */
    estimateFee(shape: SwapShape, sender: string): Promise<bigint | null>;
}
/** All this path uses of an RPC: one devInspect and its `error`. Narrow on purpose — the type itself
 *  has no place for a chain-supplied ADDRESS to enter, and a test can hand it a fake. */
export interface BluefinVersionRpc {
    devInspectTransactionBlock(input: {
        sender: string;
        transactionBlock: Transaction;
    }): Promise<{
        error?: string | null;
    }>;
}
/** The pinned addresses, returned only once the chain confirms the pinned package still verifies.
 *  A refusal ends it: this function has no other address to return. Exported so the test can hold an
 *  RPC that names a different package and watch it change nothing. */
export declare function checkedBluefinBinding(pinned: BluefinBinding, rpc: BluefinVersionRpc): Promise<BluefinBinding>;
export declare function swapReads(network: Network): SwapReads;
