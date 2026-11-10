import type { WalrusClient } from "@mysten/walrus";
type WriteAll = WalrusClient["writeEncodedBlobToNodes"];
type Writer = Pick<WalrusClient, "writeEncodedBlobToNode" | "systemState"> & {
    writeEncodedBlobToNodes: WriteAll;
};
export declare const QUORUM_GRACE_MIN_MS = 2000;
export declare const QUORUM_GRACE_MAX_MS = 20000;
export declare const STALL_FLOOR_MS = 90000;
export declare const RETRY_WAITS_MS: readonly number[];
export interface QuorumTiming {
    now?: () => number;
    stallFloorMs?: number;
    retryWaitsMs?: readonly number[];
}
/** Replace the client's all-nodes wait with quorum-then-grace. Returns the same client. */
export declare function stopAtQuorum<T extends Writer>(walrus: T, timing?: QuorumTiming): T;
export {};
