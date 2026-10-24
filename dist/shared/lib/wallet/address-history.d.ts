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
 * Sui's public GraphQL service per network (Mysten Labs). Measured 2026-10-21: the `affectedAddress`
 * filter answered back to 2023 on both networks, in 0.2–0.9 s, with `access-control-allow-origin: *`.
 * It is the only public operator of it, so it is the second tier and never the only one: a failure
 * here leaves the answer `complete: false`, never "nothing there".
 */
export declare const SUI_GRAPHQL_URLS: Readonly<Record<"mainnet" | "testnet", string>>;
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
/**
 * The deeper source over Sui's GraphQL service at `url`.
 *
 * ⛔ Anything but a clean answer throws — an error list, a missing page, a row of the wrong shape.
 *    The caller turns that into `complete: false`; it never becomes an empty history.
 */
export declare function graphqlHistory(url: string, fetchFn?: (input: string, init: RequestInit) => Promise<Response>): DeeperHistory;
