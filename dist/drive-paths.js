// Turning a path a person typed into an entry in the sealed file list, and back.
//
// ⛔ PATHS ARE NOT STORED — THEY ARE COMPUTED. The list holds a name and a parent id per entry, so
//    "photos/2026/a.jpg" exists only as the walk from a.jpg up to the root. Two folders may share
//    a last name at different depths, which is why every lookup here matches the WHOLE path and
//    why an ambiguous one is refused rather than resolved to the first hit.
//
// ⛔ AND NOTHING HERE GUESSES. A path that names nothing, and a path that names two things, are
//    both refusals with their own words. A command that picked one would eventually pick wrong on
//    somebody's account and delete the other file.
//
// ⛔ "IN THE TRASH" IS INHERITED, NOT STAMPED (2026-08-23, found by adversarial review).
//    Trashing a folder marks the FOLDER and nothing under it, on purpose: stamping the children
//    would restart each one's own thirty-day clock and make "restore" ambiguous. So an entry is in
//    the trash when it OR ANY ANCESTOR carries `deletedAt`, and reading only `entry.deletedAt` is
//    wrong. This file used to do exactly that, and the result was a drive that listed files whose
//    bytes the server had already stopped serving — the one state this tool is built to avoid.
//    ▶ The walk lives in the browser's index module, which is copied here byte for byte.
//
// ⛔ ONE PATH FUNCTION, NOT THREE. `ls`, `get` and the lookups below each had their own walk, and
//    two of them disagreed about a broken parent chain — so `ls` printed a path (`…/a.txt`) that no
//    command would accept, while an unrelated healthy file at `a.txt` became unaddressable because
//    the third walk silently resolved the orphan to the same string. **The path that is printed
//    must be the path that matches**, so there is one function and everybody calls it.
import { NmtsError } from "./errors.js";
import { buildIndex, isLive, KIND_FILE as SHARED_KIND_FILE, KIND_FOLDER as SHARED_KIND_FOLDER, trashedAt, } from "./shared/lib/drive/manifest-index.js";
/** Folder. The same numeric codes the items API uses. */
export const KIND_FOLDER = SHARED_KIND_FOLDER;
/** File. */
export const KIND_FILE = SHARED_KIND_FILE;
export { buildIndex, isLive, trashedAt };
/**
 * What a broken parent chain is drawn as.
 *
 * ⚠ It is deliberately a character nobody types. An entry whose parent is missing HAS no path a
 *   person can name, and pretending it sits at the root would let one orphan take a healthy file
 *   hostage: two different entries would answer to the same string and every command would refuse
 *   both as ambiguous.
 */
const DETACHED = "…";
/**
 * The full path of one entry, marked when the walk could not reach the root.
 *
 * ⚠ The `seen` set is not defensive tidiness: a list where two folders are each other's parent
 *   would loop forever, and a list is a file that can arrive from anywhere.
 */
export function fullPathOf(index, entry) {
    const parts = [entry.name];
    const seen = new Set([entry.id]);
    let parentId = entry.parentId;
    let detached = false;
    while (parentId !== null) {
        const parent = index.byId.get(parentId);
        if (parent === undefined || seen.has(parent.id)) {
            detached = true;
            break;
        }
        seen.add(parent.id);
        parts.unshift(parent.name);
        parentId = parent.parentId;
    }
    if (detached)
        parts.unshift(DETACHED);
    return parts.join("/");
}
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
export function underPrefix(prefix, drivePath) {
    if (prefix === "")
        return drivePath;
    const head = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return drivePath.startsWith(head) ? drivePath.slice(head.length) : drivePath;
}
export function normalisePath(input) {
    const stripped = input.replace(/^\.?\/+/u, "").replace(/\/+$/u, "").normalize("NFC");
    // A bare "." is where you already are — the top of the drive, not a folder called ".".
    return stripped === "." ? "" : stripped;
}
/** The same folding, for one name rather than a path. */
export function normaliseName(name) {
    return name.normalize("NFC");
}
/**
 * The one entry at this path, or a refusal saying which of the two ways it failed.
 *
 * ⛔ EXIT CODE 4, NOT 1: the command exists and could not do it, which is a different thing from
 *    the command being wrong. An agent is told to stop rather than to retry.
 */
export function entryAt(entries, path, options = {}) {
    const target = normalisePath(path);
    if (target === "") {
        throw new NmtsError(`"${path}" names the whole drive, not one thing in it.`, { exitCode: 2 });
    }
    const index = buildIndex(entries);
    const at = (e) => normalisePath(fullPathOf(index, e)) === target;
    const matches = entries.filter((e) => (options.includeTrashed === true || isLive(index, e)) &&
        (options.kind === undefined || e.kind === options.kind) &&
        at(e));
    const only = matches[0];
    if (only === undefined) {
        // ⛔ A path that exists BUT IS IN THE TRASH gets its own sentence. "No such thing" would send
        //    somebody looking for a typo when what they need is `--all` or `restore`.
        const trashed = entries.some((e) => !isLive(index, e) && at(e));
        throw new NmtsError(trashed ? `"${target}" is in the trash.` : `Nothing in this account is at "${target}".`, {
            exitCode: 4,
            nextStep: trashed
                ? `${options.nothingHappened ?? "Nothing changed."} \`nmts ls --all\` lists the trash.`
                : `${options.nothingHappened ?? "Nothing changed."} \`nmts ls\` lists what is there.`,
        });
    }
    if (matches.length > 1) {
        throw new NmtsError(`"${target}" names ${matches.length} things in this account.`, {
            exitCode: 4,
            nextStep: `${options.nothingHappened ?? "Nothing changed."} Rename one of them first.`,
        });
    }
    return only;
}
/**
 * The folder id a destination names, or null for the top of the drive.
 *
 * ⚠ An empty destination is the ROOT, and that is not the same as "no destination given" being an
 *   error: `--to ""` and `--to /` both mean the top, which is what somebody types to move
 *   something back out of a folder.
 */
export function folderIdFor(wanted, entries, nothingHappened) {
    if (wanted === undefined)
        return null;
    const target = normalisePath(wanted);
    if (target === "" || target === ".")
        return null;
    return entryAt(entries, target, { kind: KIND_FOLDER, ...(nothingHappened ? { nothingHappened } : {}) }).id;
}
/**
 * The names already used in one folder — what a new or renamed entry must not collide with.
 *
 * ⚠ Folded the same way paths are, so the two spellings of one visible name count as one taken
 *   name. Two entries a person cannot tell apart are worse than a refusal they can act on.
 */
export function namesIn(entries, parentId) {
    const taken = new Set();
    for (const e of entries) {
        // A trashed entry still holds its name: restoring it must not land on top of a live one.
        if (e.parentId === parentId)
            taken.add(normaliseName(e.name));
    }
    return taken;
}
