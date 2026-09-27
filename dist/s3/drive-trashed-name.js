// Making room for a file whose name something in the trash still holds.
//
// ⛔ WHY. The drive keeps a trashed entry's name taken, so that restoring it can never land on top
//    of a live file — and the upload path, seeing the name taken, stores the new file as
//    `report (2).pdf`. In S3 a deleted key is free. So a PUT to `report.pdf` after a DELETE of it
//    was stored under another name, answered 500 because the key still held nothing, and stored
//    again (and paid for again) on every retry.
//
// ⛔ THE TRASHED ONE MOVES, INSIDE THE TRASH; THE NEW ONE TAKES THE NAME. The holder is renamed to
//    the first free numbered name, so a restore later brings it back as `report (2).pdf` beside the
//    new file rather than on top of it. Nothing leaves the trash and nothing is destroyed. This is
//    the gateway's rule for a key; a person's own upload in the browser or with `nmts put` still
//    numbers the new file, which is what they see happen.
import { buildIndex, fullPathOf, isLive, KIND_FOLDER, namesIn, normaliseName, normalisePath } from "../drive-paths.js";
import { applyManyToList } from "../manifest-write.js";
import { uniqueFileName } from "../shared/lib/drive/unique-name.js";
/** The live folder a drive path names — `null` for the top — or undefined when there is none. */
function parentAt(entries, folder) {
    if (folder === undefined)
        return null;
    const index = buildIndex(entries);
    const wanted = normalisePath(folder);
    const found = entries.find((e) => e.kind === KIND_FOLDER && isLive(index, e) && normalisePath(fullPathOf(index, e)) === wanted);
    return found?.id;
}
/** The entries in the trash that hold this name in this folder, compared as the drive compares names. */
export function trashedHolders(entries, folder, name) {
    const parentId = parentAt(entries, folder);
    if (parentId === undefined)
        return [];
    const index = buildIndex(entries);
    const folded = normaliseName(name);
    return entries.filter((e) => e.parentId === parentId && normaliseName(e.name) === folded && !isLive(index, e));
}
/** The renames that free the name: each trashed holder to the first numbered name nothing holds. */
export function freeingIntents(entries, folder, name, now) {
    const holders = trashedHolders(entries, folder, name);
    const first = holders[0];
    if (first === undefined)
        return [];
    const taken = namesIn(entries, first.parentId);
    const intents = [];
    for (const holder of holders) {
        // Folded before asking, because `taken` is folded: asked with the other spelling, the name would
        // look free and the "rename" would give the holder the name it already has.
        const renamed = uniqueFileName(normaliseName(holder.name), taken);
        taken.add(normaliseName(renamed));
        intents.push({ op: "rename", id: holder.id, name: renamed, at: now });
    }
    return intents;
}
/**
 * Rename whatever in the trash holds `name` in `folder`, in one write to the file list.
 *
 * ⛔ DECIDED AGAIN ON EVERY ATTEMPT, from the list that attempt read, as every edit of the list is.
 */
export async function freeTrashedName(input, folder, name) {
    await applyManyToList(input, (entries) => freeingIntents(entries, folder, name, Date.now()));
}
