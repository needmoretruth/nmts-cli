import type { DecodedBody } from "./body.ts";
import type { StoreOutcome, WriteMeta } from "./contract.ts";
import type { WriteCondition } from "./drive-conditions.ts";
import type { ObjectChecksum } from "./multipart-assemble.ts";
import type { PartChoice } from "./xml-read.ts";
export type { PartChoice } from "./xml-read.ts";
export type { ObjectChecksum } from "./multipart-assemble.ts";
/** What the staging does with a finished file: store it in the drive at that key. */
export type StoreFile = (key: string, path: string, meta: WriteMeta, condition?: WriteCondition) => Promise<StoreOutcome>;
/** How long an upload nobody has touched is kept. S3 leaves this to a lifecycle rule. */
export declare const UPLOAD_LIFETIME_MS: number;
/** How long a finished upload is remembered, so a finish sent twice is answered the same twice. */
export declare const FINISHED_MEMORY_MS: number;
/** How often a gateway's own store sweeps its directory, and marks the uploads it is working on. */
export declare const SWEEP_EVERY_MS: number;
/** One piece, as `ListParts` describes it. */
export interface StagedPart {
    readonly partNumber: number;
    /** The quoted MD5 of the piece's bytes — what S3 answers for a part. */
    readonly etag: string;
    readonly size: number;
    readonly stagedAt: number;
}
/** One upload in progress, as `ListMultipartUploads` describes it. */
export interface StagedUpload {
    readonly uploadId: string;
    readonly key: string;
    readonly meta: WriteMeta;
    readonly initiated: number;
}
/** What a finish carries beyond its part list. */
export interface CompleteOptions {
    /**
     * Called once the upload and the list have been checked and what is left is the store, which can
     * take minutes: the gateway begins its 200 then. Every refusal about the request itself is thrown
     * before it.
     */
    readonly accepted?: (() => void) | undefined;
    /** `If-Match` / `If-None-Match` on the finish, judged where the file is stored. */
    readonly condition?: WriteCondition | undefined;
    /** What the client says the whole object comes to. */
    readonly checksum?: ObjectChecksum | null | undefined;
}
/** A bucket's uploads, as the drive the bucket has now sees them. */
export interface Staging {
    begin(key: string, meta: WriteMeta): Promise<string>;
    /** Stage one piece and answer its tag. `key` must be the one the upload began with. */
    part(uploadId: string, key: string, partNumber: number, body: DecodedBody): Promise<string>;
    /** Join exactly the listed pieces, in the order listed, and store them at the upload's key. */
    complete(uploadId: string, key: string, parts: readonly PartChoice[], options?: CompleteOptions): Promise<StoreOutcome>;
    /** Remove an upload and its pieces. One being finished is waited for first, never cut short. */
    abort(uploadId: string, key: string): Promise<void>;
    /** The pieces staged so far, by part number. */
    parts(uploadId: string, key: string): Promise<readonly StagedPart[]>;
    /** Every upload begun and neither finished nor aborted, by key and then by when it began. */
    uploads(): Promise<readonly StagedUpload[]>;
}
/** What a bucket's drive hands its view of the store, fresh on every request. */
export interface UploadAccount {
    /** Store a finished file through the bucket's drive as it is now. */
    readonly store: StoreFile;
    /**
     * Which account the bucket belongs to now. Absent, or null, means the caller does not say — the
     * account behind the bucket never changes, as it does not for `nmts s3`.
     */
    readonly owner?: (() => Promise<string | null>) | undefined;
    /** The most bytes one object may have. */
    readonly maxObjectBytes?: number | undefined;
}
export interface StagingStore {
    /** The store as one bucket sees it through the drive it has now. */
    view(bucket: string, account: UploadAccount): Staging;
    /** Remove what nobody has touched for `UPLOAD_LIFETIME_MS`: remembered uploads and the directory's own. */
    sweep(): Promise<void>;
    /** Stop sweeping, and wait for every finish in progress. The directory itself is the caller's. */
    close(): Promise<void>;
}
export interface StagingOptions {
    readonly clock?: (() => number) | undefined;
    /**
     * Sweep the directory now and then this often, on a timer that does not keep a process alive.
     * Absent: remembered uploads are swept when one begins, and the directory is left alone.
     */
    readonly sweepEveryMs?: number | undefined;
    /** How many uploads one bucket may have in progress. `MAX_UPLOADS_PER_BUCKET` unless said. */
    readonly maxUploadsPerBucket?: number | undefined;
}
export declare function createStagingStore(root: string, options?: StagingOptions): StagingStore;
/**
 * A staging for one bucket whose account never changes, storing through `store`: what a caller that
 * builds its drive once needs, and nothing more.
 */
export declare function createStaging(root: string, store: StoreFile, clock?: () => number): Staging;
