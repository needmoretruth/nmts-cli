import type { ManifestEntry } from "./manifest-codec.ts";
/** Folder items use kind 0, files kind 1 — the same numbers the items API uses. */
export declare const KIND_FOLDER = 0;
export declare const KIND_FILE = 1;
export interface ManifestIndex {
    /** Every entry, in the order the list was written. */
    readonly all: readonly ManifestEntry[];
    readonly byId: ReadonlyMap<string, ManifestEntry>;
    /** Direct children by parent id (root under its own key). Values keep list order. */
    readonly childrenByParent: ReadonlyMap<string, readonly ManifestEntry[]>;
}
/** Build the lookup structures for one version of the list. Cost is linear; do it once. */
export declare function buildIndex(entries: readonly ManifestEntry[]): ManifestIndex;
/**
 * The instant this item became trash — its own, or the nearest trashed ancestor's.
 * `null` means live. A parent chain that is broken or looping counts as live at the point it
 * breaks: showing an item whose parent vanished is recoverable, hiding it silently is not.
 */
export declare function trashedAt(index: ManifestIndex, entry: ManifestEntry): number | null;
/** Live = not trashed itself and under no trashed ancestor. */
export declare function isLive(index: ManifestIndex, entry: ManifestEntry): boolean;
/**
 * Does the ACCOUNT hold a file that whole-account export could actually write out?
 *
 * Asked by the export card, which offers itself on this and nothing else. The two wrong answers it
 * replaces are both easy to reach: counting the CURRENT LEVEL hides the card from an account whose
 * files all sit inside folders, and counting entries of any kind offers a download to a drive of
 * empty folders — one that can only answer "there is nothing to download".
 *
 * ⚠ Trashed files are excluded on purpose. They are still stored and still paid for, but export
 * writes the live drive, so a drive whose every file is in the trash has nothing to export.
 */
export declare function hasLiveFile(index: ManifestIndex): boolean;
/**
 * Live children of a folder (`null` = drive root), in list order.
 * Sorting belongs to the view: the same folder is shown by name, size and date in different places.
 */
export declare function childrenOf(index: ManifestIndex, parentId: string | null): readonly ManifestEntry[];
/**
 * What the trash view shows: items the person deleted directly, newest first.
 * A child whose parent is also trashed is deliberately absent — it is restored with its parent.
 */
export declare function trashRoots(index: ManifestIndex): readonly ManifestEntry[];
/**
 * Folder names from the root down to (and excluding) this item.
 * An entry whose chain is broken returns what could be resolved — callers render that as a
 * partial path rather than claiming the item sits at the root.
 */
export declare function pathOf(index: ManifestIndex, entry: ManifestEntry): readonly string[];
/** Every descendant of a folder, live and trashed, depth-first. The folder itself is excluded. */
export declare function descendantsOf(index: ManifestIndex, folderId: string): readonly ManifestEntry[];
/**
 * True when `folderId` is `candidateId` or sits underneath it.
 * Move targets are checked with this: dropping a folder into its own subtree would detach that
 * whole branch from the root, and nothing in the UI could reach it afterwards.
 */
export declare function isSelfOrDescendant(index: ManifestIndex, candidateId: string, folderId: string): boolean;
/**
 * Live items whose name contains `query`, case-insensitively.
 *
 * This search is COMPLETE — it reads the whole list from memory. That is a change worth knowing
 * about: the old server-backed listing could only match what had been fetched, so "no results"
 * was a claim the UI had to hedge. Here it is simply true.
 */
export declare function searchByName(index: ManifestIndex, query: string, limit?: number): readonly ManifestEntry[];
/**
 * Live files the person starred, newest first.
 *
 * Files only: a folder is already reachable in the panel's tree, so starring one would put the same
 * thing in two places and make "favourites" mean two different kinds of row.
 */
export declare function favoriteFiles(index: ManifestIndex): readonly ManifestEntry[];
/**
 * Every label in use, with how many live files wear it, ordered by the person's own locale.
 *
 * Counting here rather than in the panel matters: the count is what tells someone a label still has
 * files in it before they rename or clear it, and it must agree with what opening it shows.
 */
export declare function labelCounts(index: ManifestIndex): {
    label: string;
    count: number;
}[];
/** Live files wearing one label, newest first. */
export declare function filesWithLabel(index: ManifestIndex, label: string): readonly ManifestEntry[];
export interface DriveTotals {
    /** Live files. Folders are not counted — they hold nothing. */
    files: number;
    /** Live folders. */
    folders: number;
    /** Bytes of live files. */
    bytes: number;
    /** Files sitting in the trash (still stored, still paid for). */
    trashedFiles: number;
    /** Bytes held by trashed files — the figure that explains "deleting did not free space yet". */
    trashedBytes: number;
}
/** Whole-drive counts. Exact, because the list is complete by construction. */
export declare function totalsOf(index: ManifestIndex): DriveTotals;
