import { type SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiClientTypes } from "@mysten/sui/client";
/** What one row of history carries: the parsed transaction and every balance it moved. */
export type HistoryTransaction = SuiClientTypes.Transaction<{
    transaction: true;
    balanceChanges: true;
}>;
export interface AddressHistory {
    /** Newest first, at most the `limit` asked for. */
    transactions: HistoryTransaction[];
    /** True when the whole history was looked through — false when some of it could not be read. */
    complete: boolean;
}
/** Where history older than the node's window is read: the newest `limit` rows, newest first. */
export type DeeperHistory = (address: string, limit: number, signal?: AbortSignal) => Promise<HistoryTransaction[]>;
/**
 * How far above a node's lowest checkpoint a read starts, at most. Mainnet seals about four
 * checkpoints a second, so 20,000 is over an hour of pruning before the start falls out of the window
 * again. A node whose whole window is shorter (Suiscan's testnet node held 54 checkpoints, about
 * 13 seconds, on 2026-11-07) refuses that start as above its top and names the top; the start is then
 * the middle of the window it named. Same rule as the chain service's gift reader.
 */
export declare const WINDOW_MARGIN = 20000n;
/**
 * The checkpoint a node's window ends below, read from its refusal of a start above it, or `null`
 * for any other error. Suiscan and Mysten Labs answered `requested data above latest available;
 * start_checkpoint is <s>, and only checkpoints below <n> are available` on 2026-11-07.
 */
export declare function highestAvailable(e: unknown): bigint | null;
/**
 * The lowest checkpoint a node said it holds, read from its refusal, or `null` for any other error.
 * Suiscan and Mysten Labs both answered `requested data below earliest available; lowest available
 * checkpoint is <n>` on 2026-11-07.
 */
export declare function lowestAvailable(e: unknown): bigint | null;
/**
 * The newest transactions that moved `address`'s state, newest first.
 *
 * @param limit - how many to return at most; 1 is the cheapest "has this address any history".
 * @param deeper - where to read past the node's window; `null` when the caller named its own node and
 *   asked for nothing else (the answer is then `complete: false` whenever the window ran out).
 */
export declare function addressTransactions(client: Pick<SuiGrpcClient, "ledgerService">, address: string, limit: number, signal?: AbortSignal, deeper?: DeeperHistory | null): Promise<AddressHistory>;
/**
 * Has `address` ever been in a transaction? Throws when nobody could finish looking — "nobody could
 * tell" and "nothing is there" are opposite facts, and only the second may answer `false`.
 */
export declare function hasAddressHistory(client: Pick<SuiGrpcClient, "ledgerService">, address: string, signal?: AbortSignal, deeper?: DeeperHistory | null): Promise<boolean>;
export { graphqlHistory, SUI_GRAPHQL_URLS } from "./graphql-history.ts";
