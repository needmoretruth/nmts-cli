import { type ManifestIndex } from "./drive-paths.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/** The text to look for, folded. Empty means the option carried nothing to search on. */
export declare function needleOf(query: string): string;
/** Does this name contain the (already folded) needle? */
export declare function nameContains(name: string, needle: string): boolean;
/**
 * The ids to print for one query: the matching files, and the folders that lead to them.
 *
 * `entries` is what the listing was going to show anyway — live only, or everything under `--all`
 * — and the ancestors added here are inside that same set by construction. Being in the trash is
 * INHERITED, so a live file cannot sit under a trashed folder, and with `--all` there is nothing
 * left to be outside the set.
 */
export declare function idsForQuery(index: ManifestIndex, entries: readonly ManifestEntry[], needle: string): Set<string>;
