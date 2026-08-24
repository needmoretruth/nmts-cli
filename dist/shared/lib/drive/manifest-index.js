/** Folder items use kind 0, files kind 1 — the same numbers the items API uses. */
export const KIND_FOLDER = 0;
export const KIND_FILE = 1;
/** Parent key for the drive root. `parentId: null` is stored; this is its map key. */
const ROOT = "\u0000root";
/** Build the lookup structures for one version of the list. Cost is linear; do it once. */
export function buildIndex(entries) {
    const byId = new Map();
    const childrenByParent = new Map();
    for (const e of entries) {
        byId.set(e.id, e);
        const key = e.parentId ?? ROOT;
        const bucket = childrenByParent.get(key);
        if (bucket)
            bucket.push(e);
        else
            childrenByParent.set(key, [e]);
    }
    return { all: entries, byId, childrenByParent };
}
/**
 * The instant this item became trash — its own, or the nearest trashed ancestor's.
 * `null` means live. A parent chain that is broken or looping counts as live at the point it
 * breaks: showing an item whose parent vanished is recoverable, hiding it silently is not.
 */
export function trashedAt(index, entry) {
    let cursor = entry;
    const seen = new Set();
    while (cursor) {
        if (cursor.deletedAt !== undefined)
            return cursor.deletedAt;
        if (cursor.parentId === null)
            return null;
        if (seen.has(cursor.id))
            return null;
        seen.add(cursor.id);
        cursor = index.byId.get(cursor.parentId);
    }
    return null;
}
/** Live = not trashed itself and under no trashed ancestor. */
export function isLive(index, entry) {
    return trashedAt(index, entry) === null;
}
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
export function hasLiveFile(index) {
    return index.all.some((e) => e.kind === KIND_FILE && isLive(index, e));
}
/**
 * Live children of a folder (`null` = drive root), in list order.
 * Sorting belongs to the view: the same folder is shown by name, size and date in different places.
 */
export function childrenOf(index, parentId) {
    const bucket = index.childrenByParent.get(parentId ?? ROOT);
    if (!bucket)
        return [];
    return bucket.filter((e) => isLive(index, e));
}
/**
 * What the trash view shows: items the person deleted directly, newest first.
 * A child whose parent is also trashed is deliberately absent — it is restored with its parent.
 */
export function trashRoots(index) {
    const roots = index.all.filter((e) => {
        if (e.deletedAt === undefined)
            return false;
        if (e.parentId === null)
            return true;
        const parent = index.byId.get(e.parentId);
        // Parent gone entirely: this is the top of what remains, so it is its own root.
        return parent === undefined || trashedAt(index, parent) === null;
    });
    return roots.slice().sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}
/**
 * Folder names from the root down to (and excluding) this item.
 * An entry whose chain is broken returns what could be resolved — callers render that as a
 * partial path rather than claiming the item sits at the root.
 */
export function pathOf(index, entry) {
    const names = [];
    const seen = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId !== null) {
        if (seen.has(parentId))
            break;
        seen.add(parentId);
        const parent = index.byId.get(parentId);
        if (!parent)
            break;
        names.push(parent.name);
        parentId = parent.parentId;
    }
    names.reverse();
    return names;
}
/** Every descendant of a folder, live and trashed, depth-first. The folder itself is excluded. */
export function descendantsOf(index, folderId) {
    const out = [];
    const seen = new Set([folderId]);
    const stack = [folderId];
    while (stack.length > 0) {
        const id = stack.pop();
        for (const child of index.childrenByParent.get(id) ?? []) {
            if (seen.has(child.id))
                continue;
            seen.add(child.id);
            out.push(child);
            if (child.kind === KIND_FOLDER)
                stack.push(child.id);
        }
    }
    return out;
}
/**
 * True when `folderId` is `candidateId` or sits underneath it.
 * Move targets are checked with this: dropping a folder into its own subtree would detach that
 * whole branch from the root, and nothing in the UI could reach it afterwards.
 */
export function isSelfOrDescendant(index, candidateId, folderId) {
    if (candidateId === folderId)
        return true;
    let cursor = index.byId.get(candidateId);
    const seen = new Set();
    while (cursor && cursor.parentId !== null) {
        if (cursor.parentId === folderId)
            return true;
        if (seen.has(cursor.id))
            return false;
        seen.add(cursor.id);
        cursor = index.byId.get(cursor.parentId);
    }
    return false;
}
/**
 * Live items whose name contains `query`, case-insensitively.
 *
 * This search is COMPLETE — it reads the whole list from memory. That is a change worth knowing
 * about: the old server-backed listing could only match what had been fetched, so "no results"
 * was a claim the UI had to hedge. Here it is simply true.
 */
export function searchByName(index, query, limit = 500) {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === "")
        return [];
    const out = [];
    for (const e of index.all) {
        if (out.length >= limit)
            break;
        if (!e.name.toLocaleLowerCase().includes(needle))
            continue;
        if (!isLive(index, e))
            continue;
        out.push(e);
    }
    return out;
}
/**
 * Live files the person starred, newest first.
 *
 * Files only: a folder is already reachable in the panel's tree, so starring one would put the same
 * thing in two places and make "favourites" mean two different kinds of row.
 */
export function favoriteFiles(index) {
    return index.all
        .filter((e) => e.kind === KIND_FILE && e.favorite === true && isLive(index, e))
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
}
/**
 * Every label in use, with how many live files wear it, ordered by the person's own locale.
 *
 * Counting here rather than in the panel matters: the count is what tells someone a label still has
 * files in it before they rename or clear it, and it must agree with what opening it shows.
 */
export function labelCounts(index) {
    const counts = new Map();
    for (const e of index.all) {
        if (e.kind !== KIND_FILE || !e.labels || e.labels.length === 0)
            continue;
        if (!isLive(index, e))
            continue;
        for (const label of e.labels)
            counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
/** Live files wearing one label, newest first. */
export function filesWithLabel(index, label) {
    return index.all
        .filter((e) => e.kind === KIND_FILE &&
        (e.labels ?? []).includes(label) &&
        isLive(index, e))
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
}
/** Whole-drive counts. Exact, because the list is complete by construction. */
export function totalsOf(index) {
    const totals = {
        files: 0,
        folders: 0,
        bytes: 0,
        trashedFiles: 0,
        trashedBytes: 0,
    };
    for (const e of index.all) {
        const live = isLive(index, e);
        if (e.kind === KIND_FOLDER) {
            if (live)
                totals.folders += 1;
            continue;
        }
        if (live) {
            totals.files += 1;
            totals.bytes += e.size;
        }
        else {
            totals.trashedFiles += 1;
            totals.trashedBytes += e.size;
        }
    }
    return totals;
}
