import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
import { buildIndex, isLive, type ManifestIndex, trashedAt } from "./shared/lib/drive/manifest-index.ts";
/** Folder. The same numeric codes the items API uses. */
export declare const KIND_FOLDER = 0;
/** File. */
export declare const KIND_FILE = 1;
export { buildIndex, isLive, trashedAt };
export type { ManifestIndex };
/**
 * The full path of one entry, marked when the walk could not reach the root.
 *
 * ⚠ The `seen` set is not defensive tidiness: a list where two folders are each other's parent
 *   would loop forever, and a list is a file that can arrive from anywhere.
 */
export declare function fullPathOf(index: ManifestIndex, entry: ManifestEntry): string;
/**
 * `/photos/2026/` and `./photos/2026` and `photos/2026` are one path.
 *
 * ⛔ AND SO ARE THE TWO SPELLINGS OF `café`. Unicode gives the same visible name more than one
 *    byte sequence — macOS hands back the decomposed form from the shell and the filesystem while
 *    a browser typically wrote the composed one. Comparing raw bytes meant `nmts rm café` could
 *    address a DIFFERENT entry from the one on screen. Both sides of every comparison here are
 *    folded to one form; what gets STORED is untouched, because the name belongs to whoever wrote
 *    it.
 */
/**
 * Strip a folder's own path off one of its descendants, in DRIVE terms.
 *
 * ⛔ IT IS STRING ARITHMETIC AND NOT `node:path`. A drive path always uses `/`, whatever separator
 *    the machine reading it happens to use, and `path.relative` answers in the MACHINE's
 *    separator. On Windows that turned `deep/under.txt` into `deep\under.txt`, which the
 *    containment check downstream then refused as a name trying to leave its directory — so
 *    fetching a folder failed outright on one of the three platforms this tool ships for, and
 *    every test passed, because on the other two the two separators are the same character.
 *    ⚠ That is the whole class: a drive path and a path on this disk are different kinds of thing,
 *    and `node:path` is only ever right about the second.
 *
 * A path that is not under the prefix comes back unchanged — the caller decides what that means.
 */
export declare function underPrefix(prefix: string, drivePath: string): string;
export declare function normalisePath(input: string): string;
/** The same folding, for one name rather than a path. */
export declare function normaliseName(name: string): string;
export interface FindOptions {
    /** Include entries in the trash. Off by default — `rm` twice must not find its own work. */
    includeTrashed?: boolean;
    /** Only entries of this kind. */
    kind?: number;
    /** What the caller is about to do, for the refusal's second line. */
    nothingHappened?: string;
}
/**
 * The one entry at this path, or a refusal saying which of the two ways it failed.
 *
 * ⛔ EXIT CODE 4, NOT 1: the command exists and could not do it, which is a different thing from
 *    the command being wrong. An agent is told to stop rather than to retry.
 */
export declare function entryAt(entries: readonly ManifestEntry[], path: string, options?: FindOptions): ManifestEntry;
/**
 * The folder id a destination names, or null for the top of the drive.
 *
 * ⚠ An empty destination is the ROOT, and that is not the same as "no destination given" being an
 *   error: `--to ""` and `--to /` both mean the top, which is what somebody types to move
 *   something back out of a folder.
 */
export declare function folderIdFor(wanted: string | undefined, entries: readonly ManifestEntry[], nothingHappened?: string): string | null;
/**
 * The names already used in one folder — what a new or renamed entry must not collide with.
 *
 * ⚠ Folded the same way paths are, so the two spellings of one visible name count as one taken
 *   name. Two entries a person cannot tell apart are worse than a refusal they can act on.
 */
export declare function namesIn(entries: readonly ManifestEntry[], parentId: string | null): Set<string>;
