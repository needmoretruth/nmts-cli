// What to do when an upload's name is already in use in its destination folder. ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// UNTIL 2026-08-25 NOTHING WAS ASKED: a taken name silently became `report (2).pdf`. The owner
//   changed that — "there is a file with this name" and two choices, the way a desktop does it,
//   with "do this for all of them" when several files arrive at once.
//
// WHY THIS FILE IS PURE AND SEPARATE FROM THE DIALOG. Three callers need the same answer and only
//   one of them has a screen: the browser asks a person, the S3 gateway and the command line
//   follow a setting chosen once at setup. Putting the rule in the dialog would mean the headless
//   paths either duplicate it or drift from it.
//
// ⛔ OVERWRITE IS NOT UNDOABLE AND THIS FILE DOES NOT SOFTEN THAT. NMTS keeps no previous versions
//    (an automatic version history would spend the person's own storage on every generation), so
//    the old file is gone. What this returns is the intent; the caller is what destroys anything.
//
// ⛔ EXACT-MATCH COMPARISON, matching `unique-name.ts`: the drive holds `A.txt` and `a.txt` as two
//    files, so a case-insensitive collision here would offer to replace a file the person can see
//    is named differently.
import { uniqueFileName } from "./unique-name.js";
/**
 * Which of these collide, in batch order.
 *
 * ⛔ THE TAKEN SET GROWS AS THIS WALKS. Two files called `report.pdf` in one drop collide with each
 *    other, not only with the drive — and a caller that asked only about the drive would give both
 *    the same name. So a name that has been handed out here counts as taken from then on, and the
 *    second one is reported as a conflict too.
 */
export function findConflicts(batch, takenIn) {
    const extra = new Map();
    const seen = (parentId) => {
        let set = extra.get(parentId);
        if (!set) {
            set = new Set();
            extra.set(parentId, set);
        }
        return set;
    };
    const out = [];
    batch.forEach((item, at) => {
        const already = takenIn(item.parentId).has(item.name) || seen(item.parentId).has(item.name);
        if (already)
            out.push({ at, name: item.name, parentId: item.parentId });
        seen(item.parentId).add(item.name);
    });
    return out;
}
/**
 * Apply the choices and hand back what each file becomes.
 *
 * `choiceFor` is asked only about names that actually collide, one at a time and in batch order, so
 * a screen can put the question to a person and this walk waits. Anything it is not asked about
 * keeps its name. A batch answer ("do this for all") is the caller returning the same value from
 * then on without asking again — this file does not need to know that happened.
 *
 * ⛔ A RENAME CONSUMES THE NAME IT WAS GIVEN, an overwrite does not. Two files called `report.pdf`
 *    both overwriting would otherwise be two writes to one name — the second wins and the first is
 *    lost with nothing said. So the second one is renamed regardless of the choice, and the caller
 *    can see that because the name it gets back is not the name it asked for.
 */
export async function settle(batch, takenIn, choiceFor, 
/**
 * Can the thing holding this name be replaced at all?
 *
 * ⛔ A FOLDER CAN HOLD THE NAME. Offering "overwrite" then would offer to delete a folder and
 *    everything under it in order to store one file, from a dialog that names a file. Nothing
 *    asks; those are renamed, which is what happened before anything was asked at all.
 * ⚠ Left out means everything is replaceable, which is right for callers whose names are all
 *   files (the S3 gateway has no folders).
 */
overwritable = () => true) {
    const conflicts = new Map();
    const found = findConflicts(batch, takenIn);
    for (const c of found)
        conflicts.set(c.at, c);
    const handedOut = new Map();
    const given = (parentId) => {
        let set = handedOut.get(parentId);
        if (!set) {
            set = new Set();
            handedOut.set(parentId, set);
        }
        return set;
    };
    const takenNow = (parentId) => new Set([...takenIn(parentId), ...given(parentId)]);
    const overwrittenHere = new Map();
    const overwritten = (parentId) => {
        let set = overwrittenHere.get(parentId);
        if (!set) {
            set = new Set();
            overwrittenHere.set(parentId, set);
        }
        return set;
    };
    const out = [];
    let asked = 0;
    for (const [at, item] of batch.entries()) {
        const conflict = conflicts.get(at);
        if (conflict === undefined) {
            given(item.parentId).add(item.name);
            out.push({ name: item.name, parentId: item.parentId });
            continue;
        }
        const renamedTo = uniqueFileName(item.name, takenNow(item.parentId));
        if (!overwritable(conflict)) {
            given(item.parentId).add(renamedTo);
            out.push({ name: renamedTo, parentId: item.parentId });
            continue;
        }
        asked += 1;
        const choice = await choiceFor({ ...conflict, renamedTo, remaining: found.length - asked });
        if (choice === "overwrite" && !overwritten(item.parentId).has(item.name)) {
            overwritten(item.parentId).add(item.name);
            out.push({ name: item.name, parentId: item.parentId, replaces: item.name });
            continue;
        }
        given(item.parentId).add(renamedTo);
        out.push({ name: renamedTo, parentId: item.parentId });
    }
    return out;
}
