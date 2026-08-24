// `--find` — which entries a name query leaves in the listing.
//
// ⛔ THE QUERY NAMES FILES. A folder is never matched by it, and a folder whose own name contains
//    the text is not a result. Somebody searching for `report` wants the files called report, and
//    a listing that also printed an empty folder called `reports` would be answering a question
//    nobody asked — worse, it would print a row with nothing under it and no way to tell whether
//    the folder is empty or whether its contents were filtered away.
//
// ⛔ BUT A MATCH KEEPS ITS FOLDERS. `ls` prints whole paths, and the folders on the way to a match
//    are part of what that path means; dropping them would leave the listing describing a drive
//    whose shape is not this account's. So the entries that survive are: every file that matches,
//    plus every folder between one of those files and the top of the drive.
//
// ⛔ WHICH MEANS: UNDER A QUERY, A FOLDER HOLDING NO MATCH IS NOT PRINTED — an empty folder never
//    is, and neither is a full one whose files all fail the query. That omission is deliberate and
//    it is SAID OUT LOUD by the listing that made it, because a filtered listing that looks like a
//    full one is exactly how somebody concludes a folder was lost.
//
// ⚠ FOLDING, NOT BYTES. Both sides are lowercased through the locale before comparing, which is
//   what makes the search case-insensitive in the alphabets that have cases and harmless in the
//   ones that do not. The stored name is never touched: it belongs to whoever wrote it.

import { KIND_FOLDER, type ManifestIndex } from "./drive-paths.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";

/** The text to look for, folded. Empty means the option carried nothing to search on. */
export function needleOf(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Does this name contain the (already folded) needle? */
export function nameContains(name: string, needle: string): boolean {
  return name.toLocaleLowerCase().includes(needle);
}

/**
 * Walk from an entry to the top of the drive, marking every folder on the way as one to keep.
 *
 * ⚠ The `seen` set is not defensive tidiness. A list where two folders are each other's parent
 *   would loop here forever, and a list is a document that can be rebuilt by any device and any
 *   older build of any of them.
 */
function keepAncestors(index: ManifestIndex, entry: ManifestEntry, keep: Set<string>): void {
  const seen = new Set<string>([entry.id]);
  let parentId = entry.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = index.byId.get(parentId);
    // A broken chain simply stops: the file is printed with the detached mark its path already
    // carries, and nothing above the break is invented.
    if (parent === undefined) return;
    keep.add(parent.id);
    parentId = parent.parentId;
  }
}

/**
 * The ids to print for one query: the matching files, and the folders that lead to them.
 *
 * `entries` is what the listing was going to show anyway — live only, or everything under `--all`
 * — and the ancestors added here are inside that same set by construction. Being in the trash is
 * INHERITED, so a live file cannot sit under a trashed folder, and with `--all` there is nothing
 * left to be outside the set.
 */
export function idsForQuery(
  index: ManifestIndex,
  entries: readonly ManifestEntry[],
  needle: string,
): Set<string> {
  const keep = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === KIND_FOLDER) continue;
    if (!nameContains(entry.name, needle)) continue;
    keep.add(entry.id);
    keepAncestors(index, entry, keep);
  }
  return keep;
}
