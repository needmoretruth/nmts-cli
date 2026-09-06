import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { BlobLease, ExtendReads } from "./extend-plan.ts";
/** How long one chain question gets. A read that stalls is a read that failed. */
export declare const EXTEND_READ_TIMEOUT_MS = 20000;
/**
 * A Walrus-aware client for one network.
 *
 * ⛔ THE NETWORK NAME REACHES THE SDK AS WELL AS THE URL, exactly as it does for an upload. A
 *    mirror pointed at the wrong chain would otherwise be discovered as a refusal from the storage
 *    contract — after a transaction had been signed.
 */
export declare function walrusClient(network: string): ReturnType<typeof build>;
declare function build(network: string): import("@mysten/sui/client").ClientWithExtensions<{
    walrus: import("@mysten/walrus").WalrusClient;
}, SuiJsonRpcClient>;
/**
 * One blob's lease, read from the Blob object itself.
 *
 * ⛔ NARROWED FROM `unknown`, NOT FROM THE SDK'S TYPE. `MoveStruct` is a three-way union whose
 *    members do not all carry an index signature, so reading a field off it means asserting — and
 *    an assertion compiles whether or not the check above it is right. What matters is the shape
 *    on the wire, and the predicate in `guards.ts` is what carries that narrowing.
 */
export declare function readBlobLease(client: ReturnType<typeof build>, objectId: string): Promise<BlobLease>;
/**
 * The reads one `nmts extend` run needs, bound to one network.
 *
 * ⚠ THE WINDOW IS `null` RATHER THAN A GUESS when the network cannot be read, exactly as it is for
 *   `nmts expiring`: the caller stops. An unread clock and a file in no danger look identical from
 *   outside and are the opposite of each other.
 */
export declare function extendReads(network: string): ExtendReads;
/**
 * What a transaction actually costs in MIST: computation plus storage, less the rebate for storage
 * it freed. Clamped at zero — a rebate can exceed the rest and the chain does not pay the sender.
 * The browser app's `netGasFeeBaseUnits` is the same arithmetic.
 */
export declare function netGasFee(gasUsed: {
    computationCost: string;
    storageCost: string;
    storageRebate: string;
}): bigint;
export {};
