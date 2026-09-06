import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/**
 * Stand-in name for a file the server can no longer name. Deliberately not a sentence and
 * deliberately language-neutral: it sits in the field a person's own file names sit in, and the
 * only thing to do with it is type over it.
 */
export declare function placeholderName(id: string): string;
/** One stored file, as the server still knows it. */
export interface SourceItem {
    id: string;
    size: number;
    createdAt: number;
    updatedAt: number;
    /** Present when the row is in the trash. */
    deletedAt?: number;
    /** The wrapped file key. Absent on a row committed before the server kept one. */
    dekWrapped?: string;
    /** The sealed whole-file hash, for verifying a download. Absent on older rows. */
    contentHashCt?: string;
}
export interface RebuiltList {
    /** The entries to seal, in the order the listings returned them. */
    entries: ManifestEntry[];
    /** How many came back live. */
    live: number;
    /** How many came back from the trash — still restorable, still stored, still charged for. */
    trashed: number;
    /**
     * How many carry no wrapped key. They are still worth an entry — the row, the size and the
     * dates are real — but nothing on any device can open their bytes, and saying so is the whole
     * point of counting them.
     */
    keyless: number;
    /**
     * Rows the server says it holds that this rebuild has no entry for, or null when that could not
     * be checked. Not a failure: something thrown away before the restore window closed is exactly
     * this, and so is a file trashed while the listings were being read.
     */
    unaccounted: number | null;
}
/**
 * Turn the server's rows into entries.
 *
 * ⛔ EVERY REBUILT FILE SITS AT THE TOP OF THE DRIVE, because the server has no folder or parent
 *    left to report and inventing one would be a guess presented as a memory.
 *
 * ⛔ AND NO TWO OF THEM SHARE A NAME. A placeholder is the first characters of an id, so two ids
 *    can produce one name; in a drive addressed by path, two entries with the same path is a
 *    lookup this tool refuses rather than resolves — a file nobody can fetch. Numbering the second
 *    one costs nothing and the person is going to rename both anyway.
 */
export declare function entriesFrom(items: readonly SourceItem[]): ManifestEntry[];
export interface RebuildInput {
    server: string;
    apiKey: string;
    /** Called as pages arrive, so a large account is not a silent wait. */
    onProgress?: (read: number) => void;
}
/**
 * Read the whole account and work out the list it would be sealed as. Writes nothing.
 *
 * ⛔ THE TRASH IS READ SECOND AND WINS A TIE. An item thrown away between the two listings comes
 *    back in both; the trashed row is the newer truth, and taking the live one would resurrect
 *    something the person had just thrown away.
 */
export declare function rebuildFromServer(input: RebuildInput): Promise<RebuiltList>;
