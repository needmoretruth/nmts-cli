// The drive's own edits without a terminal: making a folder, moving, renaming, and the two halves
// of the trash — decided, written, and handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, WHICH IS THE WHOLE REASON THIS FILE EXISTS. The commands in
//    `commands/organise.ts` and `commands/trash.ts` are a terminal's shape: they print sentences
//    and answer an exit code. The SDK is somebody else's program and needs the same five verbs
//    with neither. A second implementation of "what does moving onto a taken name do" would be a
//    second place for the compare-and-swap rules to be got right, and the copy nobody re-reads is
//    the one that quietly disagrees — which is the failure this package has already had once, in
//    the two `mkdir` paths that produced `photos (2)` while printing `Made "photos"`.
//
// ⛔ NOTHING HERE WRITES TO A STREAM OR PICKS AN EXIT CODE. Every refusal is thrown and every
//    outcome is returned; the words a person reads are the caller's.
//
// ⛔ AND EVERY REFUSAL THIS FILE MAKES CARRIES A CODE. A terminal reads the sentence; a program
//    reads `error.code` and branches on it. That is why `DriveEditError` EXTENDS the tool's own
//    error rather than replacing it: the exit code and the next step are still there, `renderError`
//    prints exactly what it printed before, and `error instanceof NmtsError` is still true.
//
// ⚠ THE ARGUMENT-SHAPE REFUSALS ARE NOT HERE. "`nmts rename` needs what to rename" is about a
//   command line, and a library caller has no command line to be told about. What IS here is every
//   refusal about the LIST, because that one is the same question whoever asked it.
import { randomUUID } from "node:crypto";
import { buildIndex, entryAt, folderIdFor, fullPathOf, isLive, KIND_FILE, KIND_FOLDER, namesIn, normaliseName, normalisePath, } from "./drive-paths.js";
import { NmtsError } from "./errors.js";
import { setTrashed } from "./item-trash.js";
import { readFileList } from "./manifest.js";
import { applyManyToList, applyToList, batchTargets } from "./manifest-write.js";
import { applyIntent } from "./shared/lib/drive/manifest-ops.js";
/** A refusal about the list, with the sentence a person reads and the word a program reads. */
export class DriveEditError extends NmtsError {
    code;
    constructor(code, message, options = {}) {
        super(message, options);
        this.name = "DriveEditError";
        this.code = code;
    }
}
/**
 * Run a path lookup, and label whatever it refused as `NOT_FOUND`.
 *
 * ⛔ THE SENTENCE, THE EXIT CODE AND THE NEXT STEP ARE CARRIED THROUGH UNTOUCHED. `drive-paths.ts`
 *    words three different failures — nothing there, it is in the trash, it names two things — and
 *    each of them is better than anything this file could say about them. What is added is the one
 *    thing it cannot carry: a code, so a program does not have to read English to know a path did
 *    not resolve.
 */
function resolving(body) {
    try {
        return body();
    }
    catch (error) {
        if (error instanceof NmtsError && !(error instanceof DriveEditError)) {
            throw new DriveEditError("NOT_FOUND", error.message, {
                exitCode: error.exitCode,
                nextStep: error.nextStep,
            });
        }
        throw error;
    }
}
/**
 * A new name is a name and not a path.
 *
 * ⛔ REFUSED RATHER THAN SPLIT. A name with a `/` in it is somebody asking for a move while typing
 *    a rename, and quietly doing the move would put the file somewhere they did not look.
 */
export function requireNewName(name) {
    if (name.trim() === "") {
        throw new DriveEditError("BAD_NAME", "A name cannot be empty.", {
            exitCode: 2,
            nextStep: "Nothing was renamed.",
        });
    }
    if (name.includes("/")) {
        throw new DriveEditError("BAD_NAME", `A name cannot contain "/" — that is what makes it a path.`, {
            exitCode: 2,
            nextStep: `To move it, use \`nmts mv\`. Nothing was renamed.`,
        });
    }
    return name;
}
/**
 * Make a folder path, and every folder above it that is missing, for an account already opened.
 *
 * ⛔ THE RULES BELOW ARE THE ONES A SECOND COPY WOULD GET SUBTLY WRONG: a folder that is already
 *    there IS the folder asked for (never a numbered one), the decision is taken inside each
 *    attempt so a lost race cannot make two, and what was made before a failure is named rather
 *    than silently kept.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience. A folder costs
 *   nothing, holds nothing and can be moved to the trash, so the failure mode of creating one too
 *   many is a tidy-up; the failure mode of refusing is a caller that has to discover the tree one
 *   call at a time. Every folder made is named in the result, so it is never a surprise.
 */
export async function ensureFolderPath(input, wanted) {
    const made = [];
    let parentId = null;
    let walked = "";
    for (const name of wanted.split("/")) {
        // ⚠ A name that is only spaces is refused too. `mkdir` used to accept it, and then `rm` and
        //   `restore` rejected the very path `ls` printed for it as "no path given" — a code-2 message
        //   blaming the caller for an argument they had supplied (2026-08-23).
        if (name.trim() === "" || name === "." || name === "..") {
            throw new DriveEditError("BAD_NAME", `"${wanted}" is not a folder path this tool will make.`, {
                exitCode: 2,
                nextStep: `Empty names, "." and ".." are not folder names in a drive. Nothing was made.`,
            });
        }
        walked = walked === "" ? name : `${walked}/${name}`;
        const under = parentId;
        const here = walked;
        const fresh = randomUUID();
        let landedOn = fresh;
        // ⛔ ONE WRITE PER FOLDER, and the check that decides whether to write happens INSIDE the
        //    attempt. Two things went wrong when it sat outside (2026-08-23):
        //      · running `mkdir` twice at the same moment made `shared` AND `shared (2)`, because the
        //        loser of the compare-and-swap re-applied a decision taken against the older list;
        //      · a trashed folder of the same name made the second `mkdir` produce `photos (2)` while
        //        printing `Made "photos"`, because it went through the upload helper — and picking a
        //        free name is the right rule for BYTES and the wrong rule for a folder. A folder with
        //        that name in that parent IS the folder that was asked for.
        //    Building the whole chain in memory and writing once would be fewer round trips and would
        //    also mean a lost compare-and-swap threw away folders the ones below already point at.
        const result = await applyToList(input, (entries) => {
            const there = entries.find((e) => e.parentId === under &&
                normaliseName(e.name) === normaliseName(name) &&
                e.deletedAt === undefined);
            if (there !== undefined) {
                if (there.kind !== KIND_FOLDER) {
                    throw new DriveEditError("NAME_TAKEN", `"${here}" is a file, so nothing can be made inside it.`, {
                        exitCode: 4,
                        nextStep: made.length > 0 ? `The folders made so far are kept: ${made.join(", ")}.` : "Nothing was made.",
                    });
                }
                landedOn = there.id;
                return null;
            }
            landedOn = fresh;
            const at = Date.now();
            return {
                op: "add",
                entry: { id: fresh, parentId: under, kind: KIND_FOLDER, name, size: 0, createdAt: at, updatedAt: at },
            };
        }).catch((error) => {
            // ⛔ WHAT SURVIVED IS NAMED. A run that stops half way leaves real folders behind, and the
            //    message that says so was attached only to the "that is a file" refusal.
            if (error instanceof NmtsError || made.length === 0)
                throw error;
            const because = error instanceof Error ? error.message : "the server refused";
            throw new NmtsError(because, {
                exitCode: 1,
                nextStep: `The folders made so far are kept: ${made.join(", ")}. Running the same command again ` +
                    `makes the rest — nothing is lost.`,
            });
        });
        if (result.changed)
            made.push(here);
        parentId = landedOn;
    }
    return { parentId, made };
}
/** Make one folder path. A path that is already there is a success with nothing made. */
export async function makeFolder(input, path) {
    const wanted = normalisePath(path);
    if (wanted === "") {
        throw new DriveEditError("BAD_NAME", `"${path}" names the whole drive, not a folder in it.`, {
            exitCode: 2,
            nextStep: "Nothing was made.",
        });
    }
    const { parentId, made } = await ensureFolderPath(input, wanted);
    return { path: wanted, parentId, made };
}
/**
 * Move things into a folder. An empty destination is the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named. The list is rewritten whole on
 *    every save, so a second thing costs nothing extra — while a second WRITE is a second chance
 *    to lose the compare-and-swap, and losing it half way through a run leaves some things moved
 *    and some not, which is a state the caller cannot tell apart from the one it asked for.
 *
 * ⛔ AND THE NAME CHECK RUNS AGAINST WHAT THIS RUN HAS ALREADY MOVED, not against the list as it
 *    was read. Two files called `notes.txt` in two folders, moved into one folder by one call,
 *    would otherwise both be written — two entries at one path, which nothing can address
 *    afterwards: every lookup answers "names 2 things in this account". So the loop folds each
 *    move onto a working copy and asks the working copy the next question.
 */
export async function moveEntries(input, paths, destination) {
    const at = Date.now();
    let moved = [];
    let already = [];
    let parentId = null;
    // ⛔ EVERY GUARD RUNS INSIDE THE ATTEMPT, INCLUDING WHICH ENTRY EACH PATH NAMES. A lost
    //    compare-and-swap re-applies the intent to a list that changed underneath — and when the
    //    winner had just taken this name, the loser landed on top of it and produced two entries at
    //    one path. Meanwhile the caller was told the move had been made.
    const result = await applyManyToList(input, (now) => {
        const targets = resolving(() => batchTargets(now, paths, { nothingHappened: "Nothing was moved." }));
        const into = resolving(() => folderIdFor(destination, now, "Nothing was moved."));
        const index = buildIndex(now);
        const intents = [];
        const carried = [];
        const there = [];
        let working = now;
        for (const target of targets) {
            if (into !== null && (into === target.id || isUnder(working, into, target.id))) {
                throw new DriveEditError("INTO_ITSELF", `A folder cannot be moved inside itself.`, {
                    exitCode: 4,
                    nextStep: "Nothing was moved.",
                });
            }
            if (into === target.parentId) {
                there.push(target.name);
                continue;
            }
            if (namesIn(working, into).has(normaliseName(target.name))) {
                throw new DriveEditError("NAME_TAKEN", `Something called "${target.name}" is already in that folder.`, {
                    exitCode: 4,
                    nextStep: `Nothing was moved. Rename it first: nmts rename "${target.name}" <new name>`,
                });
            }
            const intent = { op: "move", id: target.id, parentId: into, at };
            intents.push(intent);
            working = applyIntent(working, intent);
            carried.push({ id: target.id, name: target.name, from: fullPathOf(index, target) });
        }
        moved = carried;
        already = there;
        parentId = into;
        return intents;
    });
    // ⚠ Read off the list AS WRITTEN, not off the intents: an id another device took out of the list
    //   meanwhile has no path any more, and claiming one would name a place nothing is at.
    const after = buildIndex(result.entries);
    return {
        moved: moved.map((m) => {
            const live = result.entries.find((e) => e.id === m.id);
            return { id: m.id, name: m.name, from: m.from, path: live === undefined ? null : fullPathOf(after, live) };
        }),
        already,
        parentId,
        changed: result.changed,
        reappliedAfterConflict: result.reappliedAfterConflict,
        seq: result.seq,
    };
}
/**
 * Give one thing a new name. The path stays the same otherwise.
 *
 * ⛔ REFUSED RATHER THAN NUMBERED, AND THE REFUSAL IS RE-DECIDED ON EVERY ATTEMPT. An upload picks
 *    `report (2).pdf` because nobody was watching; a rename is somebody choosing a name on purpose,
 *    and silently giving them a different one is how two files end up looking like a mistake nobody
 *    made. Checking once, before the write, was not enough: when another device took the name in
 *    between, the retry re-applied the old decision and produced two entries at one path, which
 *    nothing can address afterwards (2026-08-23).
 */
export async function renameEntry(input, path, name) {
    requireNewName(name);
    const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
    const entries = list.manifest?.entries ?? [];
    const target = resolving(() => entryAt(entries, path, { nothingHappened: "Nothing was renamed." }));
    const at = Date.now();
    const fromPath = fullPathOf(buildIndex(entries), target);
    const result = await applyToList(input, (now) => {
        const live = now.find((e) => e.id === target.id);
        if (live === undefined)
            return null;
        if (normaliseName(name) !== normaliseName(live.name) && namesIn(now, live.parentId).has(normaliseName(name))) {
            throw new DriveEditError("NAME_TAKEN", `Something called "${name}" is already in that folder.`, {
                exitCode: 4,
                nextStep: "Nothing was renamed.",
            });
        }
        return { op: "rename", id: target.id, name, at };
    });
    return {
        id: target.id,
        from: target.name,
        fromPath,
        to: name,
        changed: result.changed,
        reappliedAfterConflict: result.reappliedAfterConflict,
        seq: result.seq,
    };
}
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
/** Is `id` at or under `rootId`? Used to refuse moving a folder into its own subtree. */
function isUnder(entries, id, rootId) {
    const byId = buildIndex(entries).byId;
    const seen = new Set();
    let at = id;
    while (at !== null && !seen.has(at)) {
        if (at === rootId)
            return true;
        seen.add(at);
        at = byId.get(at)?.parentId ?? null;
    }
    return false;
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
export function filesUnder(entries, rootId) {
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
