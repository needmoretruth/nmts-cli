// `nmts rm` and `nmts restore` — the two halves of the trash.
//
// ⛔ NEITHER OF THESE DESTROYS ANYTHING. `rm` moves everything it is given to the trash, where it
//    stays restorable for thirty days; the endpoint that erases a stored row for good is closed to
//    an API key and stays closed, so no command here can reach it.
//
// ⛔ BOTH TAKE MANY PATHS AND WRITE THE LIST ONCE. Everything named is trashed together or
//    nothing is: a run that wrote once per path would be one lost compare-and-swap away from a
//    drive with half of the deletion in it, and the message would still say the whole run had
//    happened. The server rows still go one at a time — there is no batch endpoint — which is
//    why a run that stops half way names how far it got.
//
// ⚠ ONE VERB IN THIS TOOL DOES HAVE NO UNDO, AND IT IS DELIBERATELY NOT THESE TWO. `nmts sweep`
//   drops list entries whose thirty days have already run out, which destroys this account's copy
//   of the key for files the server has already destroyed its own copy of. It is a separate
//   command, it stops for an answer on every run rather than once per machine, and it can never
//   touch anything still inside the window these two work on. The sentence that used to sit here
//   said no verb without an undo would ever live in this tool; that stopped being true the day
//   the sweep arrived, and a header that goes on describing the world before a change is the way
//   the next reader is misled.
//
// ⛔ THE SERVER ROW GOES FIRST, AND "ALREADY DONE" COUNTS AS DONE. The order is not arbitrary and
//    neither is the forgiveness:
//      · A trashed item's bytes cannot be fetched — `GET /v1/items/{id}/parts` requires
//        `deleted_at IS NULL`. So the state to avoid above all others is a drive that shows a file
//        as live when the server has already trashed it: the person sees it, asks for it, and is
//        told it does not exist.
//      · Writing the list only after the server agreed means a failed server call leaves the
//        drive exactly as it was, which is the state a person can act on.
//      · And a 404 from the server means the row is already in the state being asked for, which
//        is what an interrupted run leaves behind. Treating it as a failure would make the retry
//        of a half-finished command impossible — the one moment the retry is needed.
import { request, ServerError } from "../api.js";
import { buildIndex, fullPathOf, isLive, KIND_FILE } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { applyManyToList, batchTargets } from "../manifest-write.js";
import { openSession } from "../session.js";
import { applyIntent } from "../shared/lib/drive/manifest-ops.js";
export async function rm(paths, options = {}) {
    return run("rm", paths, options);
}
export async function restore(paths, options = {}) {
    return run("restore", paths, options);
}
async function run(verb, paths, options) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (paths.length === 0) {
        throw new NmtsError(`\`nmts ${verb}\` needs the path of at least one thing in the drive.`, {
            exitCode: 2,
            nextStep: `\`nmts ls${verb === "restore" ? " --all" : ""}\` prints the paths as this expects them.`,
        });
    }
    const session = await openSession(options);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    const entries = list.manifest?.entries ?? [];
    // ⛔ `rm` REFUSES what is already in the trash rather than quietly doing nothing, so the caller
    //    learns nothing was needed; `restore` has to be able to SEE the trash to act on it. That is
    //    why the two lookups differ. (The comment that used to sit here claimed a shared lookup would
    //    make `rm` say "no such path" — it would not: the refusal below names the trash either way.
    //    A reason that does not hold teaches the next reader to keep the wrong branch.)
    //
    // ⛔ AND ONE PATH THAT WILL NOT RESOLVE REFUSES THE WHOLE RUN, before a single server row is
    //    touched. Trashing four of the five things somebody named and exiting 0 is worse than
    //    trashing none: the run reads as done, and finding the odd one out means diffing the drive.
    const index = buildIndex(entries);
    const found = batchTargets(entries, paths, {
        ...(verb === "restore" ? { includeTrashed: true } : {}),
        nothingHappened: "Nothing changed.",
    });
    const acting = [];
    const skipped = [];
    for (const entry of found) {
        const at = fullPathOf(index, entry);
        if (verb === "restore" && isLive(index, entry)) {
            // Already in the state being asked for. Not a refusal — named, and left alone.
            skipped.push(at);
            continue;
        }
        if (verb === "restore" && entry.deletedAt === undefined) {
            // In the trash, but only because something above it is. Restoring this row would clear a
            // `deletedAt` it does not have and leave the person exactly where they were.
            throw new NmtsError(`"${at}" is in the trash because a folder above it is.`, {
                exitCode: 4,
                nextStep: `Nothing changed. Restore that folder instead — \`nmts ls --all\` shows which one carries the trash.`,
            });
        }
        acting.push({ entry, path: at });
    }
    // ⛔ NAMING A FOLDER AND SOMETHING INSIDE IT IS NAMING ONE TRASHING TWICE, and only for `rm` is
    //    that a problem worth solving here: stamping the child as well would give it a thirty-day
    //    clock of its own, and then restoring the folder would leave it behind — the person would
    //    have to remember they had also named it to ever find it again. Its bytes are covered
    //    either way, because the rows are read from the folder. `restore` is the opposite case: a
    //    child with its own instant needs its own clearing, so nothing is dropped there.
    const named = new Set(acting.map((t) => t.entry.id));
    const covered = verb === "rm" ? acting.filter((t) => hasNamedAncestor(entries, t.entry, named)) : [];
    const targets = acting.filter((t) => !covered.includes(t));
    for (const t of covered)
        skipped.push(t.path);
    if (targets.length === 0) {
        // Everything named was already where it was asked to be. A no-op is a success: writing the
        // list would cost every other device a download for nothing.
        return nothingToDo(say, options, verb, skipped, list.seq ?? 0);
    }
    // Every FILE at or under the targets — a folder holds no bytes and has no server row, so the
    // rows to move are its file descendants.
    //
    // ⛔ THE ROWS TO MOVE ARE THE ONES THE EDIT WILL MAKE REACHABLE, so the set is read off a
    //    PREVIEW of the list rather than guessed (2026-08-23). `rm` is easy — everything
    //    under the target loses its bytes. `restore` is not: a file the person deleted separately
    //    last week keeps its own `deletedAt`, stays in the trash after the folder comes back, and
    //    its row must stay deleted with it. Restoring that row would cancel its own thirty-day
    //    sweep, go on costing storage, and leave the list saying "trashed" while the server says
    //    "live" — after which `rm` refuses to put it back and the tool has no way out.
    const at = Date.now();
    const ids = targets.map((t) => t.entry.id);
    const preview = buildIndex(applyIntent(entries, intentFor(verb, ids, at)));
    const under = uniqueById(targets.flatMap((t) => filesUnder(entries, t.entry.id)));
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
            await tellServer(session.server, session.apiKey, verb, file.id);
            done += 1;
        }
    }
    catch (error) {
        // ⛔ A HALF-FINISHED RUN MUST NAME ITSELF. Without this the agent sees six words of stderr and
        //    the tool's own guidance ("a refusal is not a transient error, do not retry in a loop")
        //    steers it away from the one thing that fixes this — running the same command again.
        const because = error instanceof Error ? error.message : "the server refused";
        throw new NmtsError(because, {
            exitCode: 1,
            nextStep: `${done} of ${files.length} file rows were moved before this stopped, and the file list was ` +
                `not written. Running \`nmts ${verb}\` on the same paths again finishes the job — nothing is lost.`,
        });
    }
    // ⛔ THE IDS ARE DECIDED AGAIN ON EVERY ATTEMPT, and this is not ceremony. Between the read
    //    above and the write below another device can put one of these targets in the trash — by
    //    trashing it, or by moving it under a folder that already is. Re-applying the intent we
    //    built earlier would then stamp `deletedAt` on something that is ALREADY in the trash by
    //    inheritance, giving it a clock of its own and quietly detaching it from the folder it came
    //    with: restoring that folder afterwards would leave it behind. An id that has left the list
    //    entirely is dropped for the reason `manifest-ops.ts` gives — the other device removing it
    //    is newer information than our edit, and putting it back would undo a deletion somebody
    //    made on purpose.
    const result = await applyManyToList(session, (now) => {
        const nowIndex = buildIndex(now);
        const still = ids.filter((id) => {
            const live = nowIndex.byId.get(id);
            if (live === undefined)
                return false;
            return verb === "rm" ? isLive(nowIndex, live) : live.deletedAt !== undefined;
        });
        return still.length === 0 ? [] : [intentFor(verb, still, at)];
    });
    const shown = targets.map((t) => t.path);
    if (options.json) {
        say(JSON.stringify({
            paths: shown,
            ids,
            files: files.length,
            // Named, and nothing was written for them: already out of the trash, or already covered
            // by a folder in the same run.
            skipped,
            changed: result.changed,
            // ⚠ The one signal that another writer intervened. It was printed in prose and left out of
            //   the JSON, which is the half an agent is told to read (2026-08-23).
            reappliedAfterConflict: result.reappliedAfterConflict,
            seq: result.seq,
        }));
        return 0;
    }
    const moved = files.length === 1 ? "1 file" : `${files.length} files`;
    const names = shown.map((s) => `"${s}"`).join(", ");
    say(verb === "rm"
        ? `Moved ${names} to the trash (${moved}). ${shown.length === 1 ? "It" : "They"} can be restored for 30 days.`
        : `Restored ${names} (${moved}).`);
    if (skipped.length > 0)
        say(`  ${skippedLine(verb, skipped)}`);
    if (result.reappliedAfterConflict) {
        say(`  Another device wrote the file list first, so this was applied to that version.`);
    }
    return 0;
}
/** The one intent either verb writes. Built in two places, so it is spelled in one. */
function intentFor(verb, ids, at) {
    return verb === "rm" ? { op: "trash", ids, at } : { op: "restore", ids, at };
}
/** What was named but not acted on, in the words that say why. */
function skippedLine(verb, skipped) {
    const names = skipped.map((s) => `"${s}"`).join(", ");
    return verb === "rm"
        ? `${names} is inside something else that was named, so it goes with it.`
        : `${names} was not in the trash.`;
}
/**
 * The run had nothing to do. Says so in whichever form the caller asked for.
 *
 * ⚠ In practice this is the `restore` case — everything named was already out of the trash.
 *   `rm` reaches it only if every path it resolved was inside another path it resolved, which
 *   cannot happen while the outermost one is always kept.
 */
function nothingToDo(say, options, verb, skipped, seq) {
    if (options.json) {
        say(JSON.stringify({ paths: [], ids: [], files: 0, skipped, changed: false, reappliedAfterConflict: false, seq }));
        return 0;
    }
    const names = skipped.map((s) => `"${s}"`).join(", ");
    say(verb === "restore"
        ? `${names} ${skipped.length === 1 ? "is" : "are"} not in the trash. Nothing changed.`
        : `Nothing was left to move to the trash. Nothing changed.`);
    return 0;
}
/** Is any ancestor of this entry in the set? Used to drop a target a named folder already covers. */
function hasNamedAncestor(entries, entry, named) {
    const byId = buildIndex(entries).byId;
    const seen = new Set([entry.id]);
    let at = entry.parentId;
    while (at !== null && !seen.has(at)) {
        if (named.has(at))
            return true;
        seen.add(at);
        at = byId.get(at)?.parentId ?? null;
    }
    return false;
}
/** One entry per id, keeping the first. Two named folders can hold the same file only once. */
function uniqueById(files) {
    const byId = new Map();
    for (const file of files)
        if (!byId.has(file.id))
            byId.set(file.id, file);
    return [...byId.values()];
}
/**
 * Every file at or under one entry.
 *
 * ⚠ Trashed descendants are INCLUDED HERE, and the CALLER filters. Somebody who trashed one file
 *   last week and then trashes its folder expects the folder to be gone from the server too — so
 *   `rm` takes this set whole. `restore` cannot: see the note at the call site.
 */
function filesUnder(entries, rootId) {
    const root = entries.find((e) => e.id === rootId);
    if (root === undefined)
        return [];
    if (root.kind === KIND_FILE)
        return [root];
    const childrenOf = new Map();
    for (const e of entries) {
        const list = childrenOf.get(e.parentId);
        if (list === undefined)
            childrenOf.set(e.parentId, [e]);
        else
            list.push(e);
    }
    const out = [];
    const seen = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
        const id = queue.pop();
        if (id === undefined)
            break;
        for (const child of childrenOf.get(id) ?? []) {
            if (seen.has(child.id))
                continue;
            seen.add(child.id);
            if (child.kind === KIND_FILE)
                out.push(child);
            else
                queue.push(child.id);
        }
    }
    return out;
}
/** ⛔ 404 is "already in the state you asked for", which is what a half-finished run leaves. */
async function tellServer(base, apiKey, verb, id) {
    try {
        if (verb === "rm")
            await request(base, `/v1/items/${encodeURIComponent(id)}`, { method: "DELETE", token: apiKey });
        else
            await request(base, `/v1/items/${encodeURIComponent(id)}/restore`, { method: "POST", token: apiKey, body: {} });
    }
    catch (error) {
        if (error instanceof ServerError && error.status === 404)
            return;
        throw error;
    }
}
