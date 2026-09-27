// The directory side of `nmts push`: what is on this machine, and what the drive already holds.
//
// ⚠ MOVED OUT OF `push.ts` UNCHANGED (2026-09-24) so both tiers read one tree the same way — that
//   file had reached the length gate the day NMTS Heavy needed the same walk and the same
//   "already there" rule. The rules are the ones `push.ts` states in its header: dot-files stay
//   unless asked for, symbolic links are not followed, and a name already in its folder is skipped.
import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { normaliseName, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
/** The directory as typed: refused when it is missing or a file, then walked. */
export function localTree(target, to, hidden) {
    const root = resolve(target);
    let rootStat;
    try {
        rootStat = statSync(root);
    }
    catch {
        throw new NmtsError(`There is nothing at ${root}.`, { exitCode: 4 });
    }
    if (!rootStat.isDirectory()) {
        throw new NmtsError(`${root} is a file.`, {
            exitCode: 4,
            nextStep: `Nothing was sent. \`${BINARY_NAME} put\` uploads one file.`,
        });
    }
    const under = normalisePath(to ?? "");
    const base = under === "" ? basename(root) : `${under}/${basename(root)}`;
    return { root, found: walk(root, base, hidden) };
}
/** Which found files the drive already holds, which to send, and the folders already known. */
export function splitAlready(entries, found) {
    const taken = new Set(entries
        .filter((e) => e.deletedAt === undefined)
        .map((e) => `${e.parentId ?? ""} ${normaliseName(e.name)}`));
    const folderIds = new Map();
    const already = [];
    const todo = [];
    for (const one of found) {
        const parentId = knownFolderId(entries, one.folder);
        if (parentId !== undefined)
            folderIds.set(one.folder, parentId);
        const there = parentId !== undefined && taken.has(`${parentId ?? ""} ${normaliseName(one.name)}`);
        (there ? already : todo).push(one);
    }
    return { folderIds, already, todo };
}
export { walk as filesUnderDirectory };
/** Every file under a local directory, with the drive folder each one belongs in. */
function walk(dir, driveFolder, hidden) {
    const out = [];
    const items = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
        if (!hidden && item.name.startsWith("."))
            continue;
        const local = join(dir, item.name);
        // ⛔ SYMBOLIC LINKS ARE NOT FOLLOWED. One pointing at a parent directory would walk forever,
        //    and one pointing outside would upload a file nobody meant to send.
        if (item.isSymbolicLink())
            continue;
        if (item.isDirectory()) {
            out.push(...walk(local, `${driveFolder}/${item.name}`, hidden));
            continue;
        }
        if (!item.isFile())
            continue;
        const size = statSync(local).size;
        // An empty file has nothing to store, and the storage network would refuse the reservation.
        if (size === 0)
            continue;
        out.push({ local, folder: driveFolder, name: item.name, size });
    }
    return out;
}
/** The id of a drive folder path that ALREADY exists, or undefined when it does not. */
function knownFolderId(entries, folder) {
    if (folder === "")
        return null;
    let parentId = null;
    for (const name of folder.split("/")) {
        const there = entries.find((e) => e.parentId === parentId &&
            e.kind === 0 &&
            e.deletedAt === undefined &&
            normaliseName(e.name) === normaliseName(name));
        if (there === undefined)
            return undefined;
        parentId = there.id;
    }
    return parentId;
}
