import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ObjectRow } from "./xml.ts";
/** The one bucket. Named for what it is, and not configurable: two names for one drive is worse. */
export declare const BUCKET = "drive";
/** S3's own ceiling, and the default when a client does not ask for one. */
export declare const MAX_KEYS_LIMIT = 1000;
export interface DriveObject extends ObjectRow {
    /** The entry this key came from, for the reader that follows a HEAD or GET. */
    readonly entry: ManifestEntry;
}
export interface Listing {
    readonly contents: readonly ObjectRow[];
    readonly commonPrefixes: readonly string[];
    readonly truncated: boolean;
    readonly next: string | null;
}
export interface ListQuery {
    readonly prefix: string;
    /** Only `/` means anything to S3 clients, but any string is legal and is honoured here. */
    readonly delimiter: string;
    readonly maxKeys: number;
    /** Where to resume: a continuation token, a marker, or start-after. All three are just a key. */
    readonly after: string | null;
}
/**
 * An ETag that is stable for a file and changes when the file does.
 *
 * ⛔ IT ENDS IN `-1` FOR A REASON. S3 clients treat an ETag that looks like a hex digest as the
 *    MD5 of the object and check downloads against it; this drive has no MD5 of anything -- the
 *    bytes are encrypted before they leave the machine and the digest it does keep is a different
 *    function. The `-N` suffix is S3's own mark for "assembled from parts, not an MD5", and every
 *    client already knows to skip the check when it sees one. Without it a correct download is
 *    reported as corrupt.
 */
export declare function etagOf(entry: ManifestEntry): string;
/** Every live file in the account, as keys, in the order S3 promises: ascending by key. */
export declare function objectsOf(entries: readonly ManifestEntry[]): DriveObject[];
/** Every live folder, as a key ending in the delimiter — see the note at the top of this file. */
export declare function folderPrefixesOf(entries: readonly ManifestEntry[]): string[];
/**
 * Apply prefix, delimiter and paging the way `ListObjects` does.
 *
 * The rules are S3's: a key is returned whole unless it holds the delimiter after the prefix, in
 * which case everything up to and including that delimiter becomes a common prefix and the key
 * itself is not listed. Common prefixes and keys share one page budget and one cursor.
 */
export declare function listObjects(objects: readonly DriveObject[], folders: readonly string[], query: ListQuery): Listing;
