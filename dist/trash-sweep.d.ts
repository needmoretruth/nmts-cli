import { type ManifestIndex } from "./drive-paths.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/**
 * How long a trashed item stays restorable.
 *
 * ⛔ It must match the browser's `web/src/lib/drive/manifest-views.ts::TRASH_RETENTION_DAYS`, and
 *    both of those describe the same promise the server enforces on its own rows. A tool that
 *    counted to a different number would either drop an entry whose file the person could still
 *    have restored, or leave one behind for a file whose key the server had already destroyed.
 */
export declare const TRASH_RETENTION_DAYS = 30;
/**
 * Whole days left of the thirty, counting up rather than down.
 *
 * Rounded UP so a row with four hours left says "1 day left" rather than "0 days left" — the
 * number is what somebody decides whether to restore on, and rounding it to nothing reads as
 * "already gone".
 */
export declare function daysLeftInTrash(trashedAtMs: number, nowMs: number): number;
/**
 * Entries whose thirty days have run out.
 *
 * Measured from the INHERITED instant, so a file inside a trashed folder is measured from the
 * moment the folder was thrown away — which is also the moment the server stamped on its row.
 * Reading each entry's own `deletedAt` would leave every file under a swept folder in the list.
 */
export declare function expiredTrashEntries(index: ManifestIndex, nowMs: number): ManifestEntry[];
/** What one sweep may do, and what it must not do yet. */
export interface PurgePlan {
    /** Entries that may leave the file list now. */
    drop: readonly ManifestEntry[];
    /** Expired entries the server has not let go of yet. Nothing is wrong; it sweeps on a timer. */
    waiting: readonly ManifestEntry[];
    /** Expired entries held only because something underneath them is being kept. */
    tangled: readonly ManifestEntry[];
}
/**
 * Split the expired entries into what may go and what may not.
 *
 * `stillOnServer` is every item id the server still has a row for, live or trashed. An id in that
 * set has a key the server has not destroyed, so dropping this side's copy would hide a file that
 * is still stored and still being paid for.
 *
 * ⚠ Folder entries never appear in that set — the server holds no row for a folder — so a folder
 *   is held back only by the branch rule below, which is exactly when it should be.
 */
export declare function planPurge(index: ManifestIndex, expired: readonly ManifestEntry[], stillOnServer: ReadonlySet<string>): PurgePlan;
/**
 * How many of the entries about to be dropped hold bytes.
 *
 * Said out loud before the write, because a count of ENTRIES reads as harmless — most of a trashed
 * branch is folders, which hold nothing at all — and the number that matters is how many keys are
 * being destroyed.
 */
export declare function filesAmong(entries: readonly ManifestEntry[]): number;
