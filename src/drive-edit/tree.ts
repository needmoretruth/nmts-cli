// Walking the list: the three questions the edits below ask about where an entry sits, and the one
// that gathers the files a folder carries.

import { buildIndex, KIND_FILE } from "../drive-paths.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";

/** Is `id` at or under `rootId`? Used to refuse moving a folder into its own subtree. */
export function isUnder(entries: readonly ManifestEntry[], id: string | null, rootId: string): boolean {
  const byId = buildIndex(entries).byId;
  const seen = new Set<string>();
  let at = id;
  while (at !== null && !seen.has(at)) {
    if (at === rootId) return true;
    seen.add(at);
    at = byId.get(at)?.parentId ?? null;
  }
  return false;
}

/** Is any ancestor of this entry in the set? Used to drop a target a named folder already covers. */
export function hasNamedAncestor(
  entries: readonly ManifestEntry[],
  entry: ManifestEntry,
  named: ReadonlySet<string>,
): boolean {
  const byId = buildIndex(entries).byId;
  const seen = new Set<string>([entry.id]);
  let at = entry.parentId;
  while (at !== null && !seen.has(at)) {
    if (named.has(at)) return true;
    seen.add(at);
    at = byId.get(at)?.parentId ?? null;
  }
  return false;
}

/** One entry per id, keeping the first. Two named folders can hold the same file only once. */
export function uniqueById(files: readonly ManifestEntry[]): ManifestEntry[] {
  const byId = new Map<string, ManifestEntry>();
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  return [...byId.values()];
}

/**
 * Every file at or under one entry.
 *
 * ⚠ Trashed descendants are INCLUDED HERE, and the CALLER filters. Somebody who trashed one file
 *   last week and then trashes its folder expects the folder to be gone from the server too — so
 *   `rm` takes this set whole. `restore` cannot: see the note at the call site.
 */
export function filesUnder(entries: readonly ManifestEntry[], rootId: string): ManifestEntry[] {
  const root = entries.find((e) => e.id === rootId);
  if (root === undefined) return [];
  if (root.kind === KIND_FILE) return [root];
  const childrenOf = new Map<string | null, ManifestEntry[]>();
  for (const e of entries) {
    const list = childrenOf.get(e.parentId);
    if (list === undefined) childrenOf.set(e.parentId, [e]);
    else list.push(e);
  }
  const out: ManifestEntry[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.kind === KIND_FILE) out.push(child);
      else queue.push(child.id);
    }
  }
  return out;
}
