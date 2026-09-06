import { type ManifestIndex } from "./drive-paths.ts";
/** How many of the largest files a report carries. */
export declare const BIGGEST_SHOWN = 5;
/** One of the largest files, with enough to go and fetch it. */
export interface BiggestFile {
    id: string;
    name: string;
    /** The whole path, exactly as `ls` prints it and `get` accepts it. */
    path: string;
    size: number;
}
export interface UsageReport {
    /** Live files. Folders hold nothing, so they are not in this. */
    files: number;
    /** Live folders. */
    folders: number;
    /** Plaintext bytes of the live files. */
    bytes: number;
    /** Files sitting in the trash — still stored, still paid for. */
    trashedFiles: number;
    /** Plaintext bytes held by those — the figure that explains "deleting did not free anything". */
    trashedBytes: number;
    /** The largest live files, largest first. At most `BIGGEST_SHOWN` of them. */
    biggest: BiggestFile[];
}
/**
 * The whole report, in one pass over the list.
 *
 * The counts come from the same `totalsOf` the browser's own usage figures are built on — this
 * package carries that module as a byte-for-byte copy — so the two cannot drift into disagreeing
 * about what "in the trash" means. Being in the trash is INHERITED: a file under a trashed folder
 * is trashed even though nothing marked the file itself, and a count that read only the file's own
 * mark would report bytes as live that the server has already stopped serving.
 */
export declare function computeUsage(index: ManifestIndex): UsageReport;
