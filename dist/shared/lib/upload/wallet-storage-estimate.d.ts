/** Shards on the Walrus networks NMTS uses (mainnet and testnet both, measured 2026-09-03). */
export declare const N_SHARDS = 1000;
/** `encodedBlobLength` as the SDK computes it for RS2 encoding. */
export declare function encodedBlobLength(unencodedLength: number, nShards?: number): number;
export interface WalletStorageEstimate {
    /** Raw bytes of the files in the batch. */
    rawBytes: number;
    /** What an empty blob already costs — the part every batch carries whatever is in it. */
    fixedBytes: number;
    /** Bytes the batch buys in total, coding and fixed part included. */
    boughtBytes: number;
    /** How much of what is bought is the fixed part — near 1 for one small file. */
    fixedShare: number;
}
/** What one batch (one blob) buys for `rawBytes` of files. */
export declare function estimateWalletStorage(rawBytes: number): WalletStorageEstimate;
