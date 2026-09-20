import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
/** Is `id` at or under `rootId`? Used to refuse moving a folder into its own subtree. */
export declare function isUnder(entries: readonly ManifestEntry[], id: string | null, rootId: string): boolean;
/** Is any ancestor of this entry in the set? Used to drop a target a named folder already covers. */
export declare function hasNamedAncestor(entries: readonly ManifestEntry[], entry: ManifestEntry, named: ReadonlySet<string>): boolean;
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
