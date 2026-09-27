import type { ChecksumAlgorithm } from "./checksum.ts";
import type { StoreOutcome, WriteMeta } from "./contract.ts";
import type { StagedPart, Staging, UploadAccount } from "./staging.ts";
/** One piece, and what it was held to. */
export interface Piece extends StagedPart {
    /** The piece's own file: a fresh name each time, so a piece sent twice never mixes with itself. */
    readonly file: string;
    /** The checksums its request held it to, for a finish that names a composite one. */
    readonly checksums: ReadonlyMap<ChecksumAlgorithm, Buffer>;
}
export interface Upload {
    readonly bucket: string;
    readonly key: string;
    readonly meta: WriteMeta;
    /** The account the bucket belonged to when this began. */
    readonly owner: string | null;
    readonly initiated: number;
    lastActivity: number;
    /** Pieces arriving now. An upload with any is in use and is not swept. */
    arriving: number;
    readonly pieces: Map<number, Piece>;
    /** The finish in progress, which a second finish of the same upload waits on rather than repeats. */
    finishing: Promise<StoreOutcome> | null;
}
/** A finished upload, remembered so a finish sent twice is answered the same twice. */
export interface Finished {
    readonly bucket: string;
    readonly key: string;
    readonly owner: string | null;
    readonly outcome: StoreOutcome;
    readonly at: number;
}
/** What every bucket's view shares: the uploads, and what the store does with them. */
export interface UploadBook {
    readonly inFlight: Map<string, Upload>;
    readonly finished: Map<string, Finished>;
    readonly clock: () => number;
    readonly maxPerBucket: number;
    dirOf(uploadId: string): string;
    /** Forget an upload and remove its pieces — unless a finish is reading them, which removes them itself. */
    drop(uploadId: string, upload: Upload): Promise<void>;
    /** Remove what nobody has touched for a day, from memory and from disk. */
    sweepMemory(): Promise<void>;
}
export declare function bucketView(book: UploadBook, bucket: string, account: UploadAccount): Staging;
