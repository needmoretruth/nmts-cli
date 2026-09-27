/**
 * The five characters XML cannot carry raw, escaped -- and what it cannot carry at all, replaced.
 *
 * ⛔ A NAME WITH A CONTROL CHARACTER IN IT MUST NOT BREAK THE DOCUMENT IT IS LISTED IN. `&#1;` is no
 *    way out: XML 1.0 forbids the reference as it forbids the character, and a parser that meets
 *    either refuses the whole listing -- every other file in it along with the one badly named.
 *    Such a name is answered with U+FFFD in its place, which the client can at least see; the exact
 *    name is what `encoding-type=url` is for, and that path percent-encodes it before it gets here.
 * ⚠ A CARRIAGE RETURN IS LEGAL BUT DOES NOT SURVIVE PARSING: a parser turns it into a line feed,
 *   and the client reads a different name from the one stored. As a reference it arrives intact.
 */
export declare function escapeXml(value: string): string;
export declare const HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
export declare const NS = "http://s3.amazonaws.com/doc/2006-03-01/";
/** Who owns and began everything here, as far as a client can be told. */
export declare const OWNER = "<ID>nmts</ID><DisplayName>nmts</DisplayName>";
/** S3's error document. `requestId` names the answer it belongs to, when there is one to name. */
export declare function errorXml(code: string, message: string, resource: string, requestId?: string): string;
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
/**
 * `encoding-type=url` means every name in the answer comes back percent-encoded -- control
 * characters included, which is how a client gets such a name exactly.
 *
 * ⚠ HALF A SURROGATE PAIR HAS NO UTF-8 FORM TO PERCENT-ENCODE, and `encodeURIComponent` throws on
 *   one; it is replaced first, as `escapeXml` would replace it.
 */
export declare function out(value: string, encodingType: string | null): string;
export declare function listObjectsXml(listing: ListingXml): string;
/**
 * Where the bucket lives: nowhere a region names.
 *
 * ⚠ EMPTY IS S3'S OWN WAY OF SAYING `us-east-1`, which is what a client that asks should sign
 *   with — and this gateway accepts a signature in any region anyway.
 */
export declare function locationXml(): string;
/** Versioning was never turned on, which S3 answers with an empty configuration. */
export declare function versioningXml(): string;
export declare function copyObjectXml(etag: string, lastModified: string): string;
export interface DeleteOutcome {
    readonly deleted: readonly string[];
    readonly errors: ReadonlyArray<{
        readonly key: string;
        readonly code: string;
        readonly message: string;
    }>;
}
/** The answer to `DeleteObjects`. In quiet mode the caller passes no `deleted`, as S3 does. */
export declare function deleteResultXml(outcome: DeleteOutcome): string;
