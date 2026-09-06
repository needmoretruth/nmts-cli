import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/** The three marks, in the shape `ls --json` prints and `markSuffix` draws. */
export interface EntryMarks {
    /** Starred: shown in the drive's favourites as well as in the folder the file lives in. */
    favorite: boolean;
    /** Held at the top of its own folder's listing, whatever the sort says. */
    pinned: boolean;
    /** The person's own labels for this entry, as text. Empty when it wears none. */
    labels: readonly string[];
}
/**
 * The marks on one entry — always all three.
 *
 * ⚠ ABSENT IS `false` HERE AND ABSENCE IN THE LIST, and the difference is deliberate. The format
 *   writes a mark only when it is on, because the whole list is re-sealed on every change and
 *   re-downloaded on every cold start. A reader parsing this needs the opposite: a field that is
 *   always there, so "this file is not starred" cannot be mistaken for "this output does not say".
 */
export declare function marksOf(entry: ManifestEntry): EntryMarks;
/**
 * What `ls` puts after a row, or an empty string when the entry wears no mark.
 *
 * ⚠ It carries its own leading spaces, exactly like the trash suffix beside it, so a row with no
 *   marks is byte-for-byte the row that was printed before marks existed.
 */
export declare function markSuffix(marks: EntryMarks): string;
