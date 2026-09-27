import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ObjectRow } from "./xml.ts";
/**
 * The bucket `nmts s3` serves. Named for what it is, and not configurable: two names for one drive
 * is worse.
 *
 * ⚠ IT IS THIS COMMAND'S ANSWER, NOT THE SERVER'S RULE. The gateway takes a resolver, because a
 *   business running it in front of many of its users' accounts has one bucket per account; what
 *   `nmts s3` hands it is a resolver that knows this name and no other.
 */
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
 * ⛔ IT IS A HASH OF WHAT CHANGES WHEN THE FILE DOES: the entry's id, its time and its size. A file
 *    replaced at the same key is a new entry; one edited in place has a new time. The tag used to
 *    be the id and the time laid side by side and cut to 32 characters, which for a long id cut the
 *    time off altogether — and a tag that does not change when the file does is how a sync tool
 *    decides there is nothing to fetch.
 *
 * ⛔ IT ENDS IN `-1` FOR A REASON. S3 clients treat an ETag that looks like a hex digest as the
 *    MD5 of the object and check downloads against it; this drive has no MD5 of anything -- the
 *    bytes are encrypted before they leave the machine and the digest it does keep is a different
 *    function. The `-N` suffix is S3's own mark for "assembled from parts, not an MD5", and every
 *    client already knows to skip the check when it sees one. Without it a correct download is
 *    reported as corrupt.
 */
export declare function etagOf(entry: ManifestEntry): string;
/** The tag of an object with no bytes: the MD5 of nothing, which is what S3 answers for one. */
export declare const EMPTY_ETAG = "\"d41d8cd98f00b204e9800998ecf8427e\"";
/**
 * Two keys in the order S3 lists them, which is the order of their UTF-8 bytes.
 *
 * ⛔ NOT `<`. JavaScript compares UTF-16 code units, and those put a character above U+FFFF (most
 *    emoji) BEFORE one in U+E000–U+FFFF, where UTF-8 puts it after. A client that pages through a
 *    listing resumes after the last key it saw, so a listing in the other order skips keys or
 *    repeats them.
 */
export declare function compareKeys(a: string, b: string): number;
/** True for the key of a folder marker: it ends in `/`. */
export declare function isFolderKey(key: string): boolean;
/**
 * Every live file in the account, and every live folder as its marker, as keys, in the order S3
 * promises: ascending by key.
 *
 * ⚠ A MARKER'S ENTRY IS THE FOLDER'S, WITH AN EMPTY `dekWrapped`. A folder has no key to open, and
 *   the reader refuses an entry with none; the empty string says "nothing to open", and the drive's
 *   own `fetch` answers a folder with no bytes before anything would try.
 */
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
