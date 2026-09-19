/** The five characters XML cannot carry raw. */
export declare function escapeXml(value: string): string;
export declare function errorXml(code: string, message: string, resource: string): string;
/**
 * The answer to `ListBuckets`.
 *
 * ⚠ AN EMPTY LIST IS A LEGAL ANSWER AND EVERY CLIENT HANDLES IT. A gateway in front of a
 *   business's own lookup cannot enumerate that business's customers, and naming none is the true
 *   answer there — the caller reaches its own bucket by asking for it by name.
 */
export declare function listBucketsXml(buckets: readonly string[], createdAt: string): string;
export declare function initiateUploadXml(bucket: string, key: string, uploadId: string): string;
export declare function completeUploadXml(bucket: string, key: string, etag: string): string;
export interface ObjectRow {
    readonly key: string;
    readonly lastModified: string;
    readonly etag: string;
    readonly size: number;
}
export interface ListingXml {
    readonly bucket: string;
    readonly prefix: string;
    readonly delimiter: string;
    readonly maxKeys: number;
    /** Version 2 of the listing call names its cursor differently and counts what it returned. */
    readonly v2: boolean;
    readonly contents: readonly ObjectRow[];
    readonly commonPrefixes: readonly string[];
    readonly truncated: boolean;
    /** The cursor a client sends back to continue, when there is more. */
    readonly next: string | null;
    /** What the client asked to be url-encoded, or null when it asked for nothing. */
    readonly encodingType: string | null;
}
export declare function listObjectsXml(listing: ListingXml): string;
