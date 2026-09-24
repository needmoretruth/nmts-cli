// The two halves of the trash: moving things into it, and bringing them back.
import { buildIndex, fullPathOf, isLive, normaliseName } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { setTrashed } from "../item-trash.js";
import { readFileList } from "../manifest.js";
import { applyManyToList, batchTargets } from "../manifest-write.js";
import { applyIntent } from "../shared/lib/drive/manifest-ops.js";
import { DriveEditError, resolving } from "./errors.js";
import { filesUnder, hasNamedAncestor, uniqueById, withPreviews } from "./tree.js";
/**
 * Move things to the trash, or bring them back.
 *
 * ⛔ NEITHER HALF DESTROYS ANYTHING. `rm` moves everything it is given to the trash, where it stays
 *    restorable for thirty days; the endpoint that erases a stored row for good is closed to an API
 *    key and stays closed, so nothing here can reach it.
 *
 * ⛔ THE SERVER ROW GOES FIRST, AND "ALREADY DONE" COUNTS AS DONE. A trashed item's bytes cannot be
 *    fetched, so the state to avoid above all others is a list that shows a file as live when the
 *    server has already trashed it: the person sees it, asks for it, and is told it does not exist.
 *    Writing the list only after the server agreed means a failed server call leaves the drive
 *    exactly as it was — the state a caller can act on.
 *
 * ⛔ AND ONE PATH THAT WILL NOT RESOLVE REFUSES THE WHOLE RUN, before a single server row is
 *    touched. Trashing four of the five things somebody named and answering success is worse than
 *    trashing none: the run reads as done, and finding the odd one out means diffing the drive.
 */
export async function trashPaths(input, verb, paths, options = {}) {
    const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
    const entries = list.manifest?.entries ?? [];
    // ⛔ `rm` REFUSES what is already in the trash rather than quietly doing nothing, so the caller
    //    learns nothing was needed; `restore` has to be able to SEE the trash to act on it. That is
    //    why the two lookups differ.
    const index = buildIndex(entries);
    const found = resolving(() => batchTargets(entries, paths, {
        ...(verb === "restore" ? { includeTrashed: true } : {}),
        nothingHappened: "Nothing changed.",
    }));
    const acting = [];
    const skipped = [];
    for (const entry of found) {
        const at = fullPathOf(index, entry);
        if (verb === "restore" && isLive(index, entry)) {
            // Already in the state being asked for. Named, and left alone — unless the caller is a
            // program, which cannot read a line about it.
            if (options.strict === true) {
                throw new DriveEditError("NOT_IN_TRASH", `"${at}" is not in the trash.`, {
                    exitCode: 4,
                    nextStep: "Nothing changed. Only something in the trash can be restored.",
                });
            }
            skipped.push(at);
            continue;
        }
        if (verb === "restore" && entry.deletedAt === undefined) {
            // In the trash, but only because something above it is. Restoring this row would clear a
            // `deletedAt` it does not have and leave the person exactly where they were.
            throw new DriveEditError("NOT_IN_TRASH", `"${at}" is in the trash because a folder above it is.`, {
                exitCode: 4,
                nextStep: `Nothing changed. Restore that folder instead — \`nmts ls --all\` shows which one carries the trash.`,
            });
        }
        acting.push({ entry, path: at });
    }
    // ⛔ NAMING A FOLDER AND SOMETHING INSIDE IT IS NAMING ONE TRASHING TWICE, and only for `rm` is
    //    that a problem worth solving here: stamping the child as well would give it a thirty-day
    //    clock of its own, and then restoring the folder would leave it behind — the person would
    //    have to remember they had also named it to ever find it again. Its bytes are covered either
    //    way, because the rows are read from the folder. `restore` is the opposite case: a child with
    //    its own instant needs its own clearing, so nothing is dropped there.
    const named = new Set(acting.map((t) => t.entry.id));
    const covered = verb === "rm" ? acting.filter((t) => hasNamedAncestor(entries, t.entry, named)) : [];
    const targets = acting.filter((t) => !covered.includes(t));
    for (const t of covered)
        skipped.push(t.path);
    if (targets.length === 0) {
        // Everything named was already where it was asked to be. A no-op is a success: writing the
        // list would cost every other device a download for nothing.
        return { paths: [], ids: [], files: 0, skipped, changed: false, reappliedAfterConflict: false, seq: list.seq ?? 0 };
    }
    // Every FILE at or under the targets — a folder holds no bytes and has no server row, so the
    // rows to move are its file descendants.
    //
    // ⛔ THE ROWS TO MOVE ARE THE ONES THE EDIT WILL MAKE REACHABLE, so the set is read off a PREVIEW
    //    of the list rather than guessed (2026-08-23). `rm` is easy — everything under the target
    //    loses its bytes. `restore` is not: a file the person deleted separately last week keeps its
    //    own `deletedAt`, stays in the trash after the folder comes back, and its row must stay
    //    deleted with it. Restoring that row would cancel its own thirty-day sweep, go on costing
    //    storage, and leave the list saying "trashed" while the server says "live" — after which
    //    `rm` refuses to put it back and there is no way out.
    const at = Date.now();
    // A video's hidden preview picture goes into and out of the trash with it (gallery spec §4).
    const under = withPreviews(entries, targets.flatMap((t) => filesUnder(entries, t.entry.id)));
    const chosen = targets.map((t) => t.entry.id);
    const ids = [...chosen, ...under.filter((f) => f.thumbOf !== undefined && !chosen.includes(f.id)).map((f) => f.id)];
    const preview = buildIndex(applyIntent(entries, intentFor(verb, ids, at)));
    // ⚠ Judged on the PREVIEW's own row, not on the one in hand: `applyIntent` returns new objects,
    //   so asking the preview about the old object reads the old `deletedAt` and answers "still
    //   trashed" for the very thing being restored.
    const files = verb === "rm"
        ? under
        : under.filter((f) => {
            const after = preview.byId.get(f.id);
            return after !== undefined && isLive(preview, after);
        });
    let done = 0;
    try {
        for (const file of files) {
            await setTrashed(input.server, input.apiKey, file.id, verb === "rm");
            done += 1;
        }
    }
    catch (error) {
        // ⛔ A HALF-FINISHED RUN MUST NAME ITSELF. Without this an agent sees six words of stderr and
        //    the tool's own guidance ("a refusal is not a transient error, do not retry in a loop")
        //    steers it away from the one thing that fixes this — running the same command again.
        const because = error instanceof Error ? error.message : "the server refused";
        throw new NmtsError(because, {
            exitCode: 1,
            nextStep: `${done} of ${files.length} file rows were moved before this stopped, and the file list was ` +
                `not written. Running \`nmts ${verb}\` on the same paths again finishes the job — nothing is lost.`,
        });
    }
    // ⛔ THE IDS ARE DECIDED AGAIN ON EVERY ATTEMPT, and this is not ceremony. Between the read above
    //    and the write below another device can put one of these targets in the trash — by trashing
    //    it, or by moving it under a folder that already is. Re-applying the intent we built earlier
    //    would then stamp `deletedAt` on something that is ALREADY in the trash by inheritance,
    //    giving it a clock of its own and quietly detaching it from the folder it came with:
    //    restoring that folder afterwards would leave it behind. An id that has left the list
    //    entirely is dropped for the reason `manifest-ops.ts` gives — the other device removing it is
    //    newer information than our edit, and putting it back would undo a deletion somebody made on
    //    purpose.
    const writing = applyManyToList(input, (now) => {
        const nowIndex = buildIndex(now);
        const still = ids.filter((id) => {
            const live = nowIndex.byId.get(id);
            if (live === undefined)
                return false;
            return verb === "rm" ? isLive(nowIndex, live) : live.deletedAt !== undefined;
        });
        if (verb === "restore" && options.strict === true)
            refuseTakenNames(now, nowIndex.byId, still);
        return still.length === 0 ? [] : [intentFor(verb, still, at)];
    });
    // ⛔ A STRICT RESTORE REFUSED HERE HAS ALREADY MOVED ITS ROWS. The name was free when the trash
    //    was read and taken by the time the list was written, so the rows above are live while the
    //    list still says trashed — the state the note on `files` calls no way out. Put the rows back
    //    before the refusal leaves. If putting them back fails too, the refusal still leaves as it
    //    is: restoring again after the rename moves the same rows and writes the list.
    const result = await writing.catch(async (error) => {
        if (verb === "restore" && error instanceof DriveEditError && error.code === "NAME_TAKEN") {
            for (const file of files) {
                await setTrashed(input.server, input.apiKey, file.id, true).catch(() => undefined);
            }
        }
        throw error;
    });
    return {
        paths: targets.map((t) => t.path),
        ids,
        files: files.length,
        skipped,
        changed: result.changed,
        reappliedAfterConflict: result.reappliedAfterConflict,
        seq: result.seq,
    };
}
/**
 * Refuse a restore that would land beside a live thing of the same name.
 *
 * ⛔ DECIDED INSIDE THE ATTEMPT like every other guard here: the name that was free when the trash
 *    was read can be taken by the time the list is written, and two entries at one path is a state
 *    no lookup can get out of.
 */
function refuseTakenNames(entries, byId, ids) {
    const index = buildIndex(entries);
    for (const id of ids) {
        const entry = byId.get(id);
        if (entry === undefined)
            continue;
        const holder = entries.find((e) => e.id !== id && e.parentId === entry.parentId && normaliseName(e.name) === normaliseName(entry.name) && isLive(index, e));
        if (holder === undefined)
            continue;
        throw new DriveEditError("NAME_TAKEN", `Something called "${entry.name}" is already in that folder.`, {
            exitCode: 4,
            nextStep: "The file list was not changed. Rename the one that is there, then restore again.",
        });
    }
}
/** The one intent either half of the trash writes. Built in two places, so it is spelled in one. */
function intentFor(verb, ids, at) {
    return verb === "rm" ? { op: "trash", ids, at } : { op: "restore", ids, at };
}
