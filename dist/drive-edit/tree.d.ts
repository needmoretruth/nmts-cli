import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
/** Is `id` at or under `rootId`? Used to refuse moving a folder into its own subtree. */
export declare function isUnder(entries: readonly ManifestEntry[], id: string | null, rootId: string): boolean;
/** Is any ancestor of this entry in the set? Used to drop a target a named folder already covers. */
export declare function hasNamedAncestor(entries: readonly ManifestEntry[], entry: ManifestEntry, named: ReadonlySet<string>): boolean;
/**
 * `files` and the preview pictures of the videos among them. A video's
 * picture is a file of its own, hidden from every listing while the video is there, so it goes
 * wherever the video goes — left behind, it would be charged for and then show up on its own.
 */
export declare function withPreviews(entries: readonly ManifestEntry[], files: readonly ManifestEntry[]): ManifestEntry[];
/** One entry per id, keeping the first. Two named folders can hold the same file only once. */
export declare function uniqueById(files: readonly ManifestEntry[]): ManifestEntry[];
/**
 * Every file at or under one entry.
 *
 * ⚠ Trashed descendants are INCLUDED HERE, and the CALLER filters. Somebody who trashed one file
 *   last week and then trashes its folder expects the folder to be gone from the server too — so
 *   `rm` takes this set whole. `restore` cannot: see the note at the call site.
 */
export declare function filesUnder(entries: readonly ManifestEntry[], rootId: string): ManifestEntry[];
/**
 * Every FOLDER under one entry, the root itself excluded. Empty when the root is a file.
 *
 * ⛔ IT EXISTS BECAUSE A FOLDER WITH NO FILE IN IT HAS NOTHING TO CARRY IT OUT. What leaves the
 *    sealed list is decided from the files under a named folder; a sub-folder holding none was in
 *    nobody's set, so it stayed — an entry whose parent had gone, which the list still showed and
 *    nothing could open or reach (2026-09-20).
 *
 * ⚠ Trashed descendants are included, for the reason `filesUnder` includes them: somebody who
 *   trashed a sub-folder last week and then erases its parent expects both to be gone.
 */
export declare function foldersUnder(entries: readonly ManifestEntry[], rootId: string): ManifestEntry[];
