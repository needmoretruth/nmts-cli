// `nmts mkdir`, `nmts mv` and `nmts rename` — the three edits that touch no bytes.
//
// ⛔ NONE OF THESE ASKS THE SERVER TO CHANGE ANYTHING BUT THE SEALED LIST. A folder has no server
//    row at all, and a name and a parent live only inside the list — the server holds an id, a
//    size and a time, and was deliberately never given a place to put a name
//    (`PATCH /v1/items/{id}` was removed from the API for exactly that reason).
//    ⚠ They are not offline and they are not unobserved: each one reads the list and writes it
//      back, so the server sees a manifest write of a known size at a known moment. The sentence
//      that used to sit here said "invisible to us", which was never true (2026-08-23).
//
// ⛔ AND NONE OF THEM STOPS TO ASK. Renaming, moving and making a folder are reversible and cost
//    nothing, which is the whole test for whether this tool interrupts somebody. It does not.
import { randomUUID } from "node:crypto";
import { buildIndex, entryAt, folderIdFor, fullPathOf, KIND_FOLDER, namesIn, normaliseName, normalisePath, } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { applyManyToList, applyToList, batchTargets } from "../manifest-write.js";
import { openSession } from "../session.js";
import { applyIntent } from "../shared/lib/drive/manifest-ops.js";
const say_ = (line) => void process.stdout.write(`${line}\n`);
/**
 * Make a folder, and any folder above it that is missing.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience. A folder costs
 *   nothing, holds nothing and can be moved to the trash, so the failure mode of creating one too
 *   many is a tidy-up; the failure mode of refusing is an agent that has to discover the tree one
 *   command at a time. Every folder made is named in the output, so it is never a surprise.
 */
/**
 * Make a folder path, and every folder above it that is missing, under an OPEN session.
 *
 * ⛔ SPLIT OUT SO AN UPLOAD OF A WHOLE DIRECTORY CAN USE IT. The rules below are the ones a second
 *    copy would get subtly wrong: a folder that is already there IS the folder asked for (never a
 *    numbered one), the decision is taken inside each attempt so a lost race cannot make two, and
 *    what was made before a failure is named rather than silently kept.
 */
export async function ensureFolderPath(session, wanted) {
    const made = [];
    let parentId = null;
    let walked = "";
    for (const name of wanted.split("/")) {
        // ⚠ A name that is only spaces is refused too. `mkdir` used to accept it, and then `rm` and
        //   `restore` rejected the very path `ls` printed for it as "no path given" — a code-2 message
        //   blaming the caller for an argument they had supplied (2026-08-23).
        if (name.trim() === "" || name === "." || name === "..") {
            throw new NmtsError(`"${wanted}" is not a folder path this tool will make.`, {
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
        const result = await applyToList(session, (entries) => {
            const there = entries.find((e) => e.parentId === under &&
                normaliseName(e.name) === normaliseName(name) &&
                e.deletedAt === undefined);
            if (there !== undefined) {
                if (there.kind !== KIND_FOLDER) {
                    throw new NmtsError(`"${here}" is a file, so nothing can be made inside it.`, {
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
export async function mkdir(path, options = {}) {
    const say = options.write ?? say_;
    const wanted = normalisePath(path ?? "");
    if (wanted === "") {
        throw new NmtsError("`nmts mkdir` needs the path of the folder to make.", { exitCode: 2 });
    }
    const session = await openSession(options);
    const { parentId, made } = await ensureFolderPath(session, wanted);
    if (options.json) {
        say(JSON.stringify({ path: wanted, id: parentId, made }));
        return 0;
    }
    // ⛔ THE FOLDERS ARE NAMED, NOT COUNTED. "including 2 folder(s) above it" cannot disagree with
    //    what was written, so it could never have caught a helper quietly renaming one.
    if (made.length === 0)
        say(`"${wanted}" is already there. Nothing was made.`);
    else
        say(`Made ${made.map((m) => `"${m}"`).join(", ")}.`);
    return 0;
}
/**
 * Move things into a folder. Every operand but the last is something to move; the last is where
 * they go, and an empty one means the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named. The list is rewritten whole on
 *    every save, so a second thing costs nothing extra — while a second WRITE is a second chance
 *    to lose the compare-and-swap, and losing it half way through a run leaves some things moved
 *    and some not, which is a state the caller cannot tell apart from the one it asked for.
 *
 * ⛔ AND THE NAME CHECK RUNS AGAINST WHAT THIS RUN HAS ALREADY MOVED, not against the list as it
 *    was read. Two files called `notes.txt` in two folders, moved into one folder by one command,
 *    would otherwise both be written — two entries at one path, which no command in this tool can
 *    address afterwards: every one of them answers "names 2 things in this account". So the loop
 *    folds each move onto a working copy and asks the working copy the next question.
 */
export async function mv(operands, options = {}) {
    const say = options.write ?? say_;
    const destination = operands.at(-1);
    const paths = operands.slice(0, -1);
    if (destination === undefined || paths.length === 0) {
        throw new NmtsError("`nmts mv` needs what to move and where to put it.", {
            exitCode: 2,
            nextStep: `For example: nmts mv notes.txt archive   ·   nmts mv a.txt b.txt archive   ·   ` +
                `nmts mv archive/notes.txt /`,
        });
    }
    const session = await openSession(options);
    const at = Date.now();
    const outcome = { moved: [], already: [], parentId: null };
    // ⛔ EVERY GUARD RUNS INSIDE THE ATTEMPT, INCLUDING WHICH ENTRY EACH PATH NAMES. A lost
    //    compare-and-swap re-applies the intent to a list that changed underneath — and when the
    //    winner had just taken this name, the loser landed on top of it and produced two entries at
    //    one path. Meanwhile the tool exited 0 and said the move had been made.
    const result = await applyManyToList(session, (now) => {
        const targets = batchTargets(now, paths, { nothingHappened: "Nothing was moved." });
        const into = folderIdFor(destination, now, "Nothing was moved.");
        const intents = [];
        const moved = [];
        const already = [];
        let working = now;
        for (const target of targets) {
            if (into !== null && (into === target.id || isUnder(working, into, target.id))) {
                throw new NmtsError(`A folder cannot be moved inside itself.`, {
                    exitCode: 4,
                    nextStep: "Nothing was moved.",
                });
            }
            if (into === target.parentId) {
                already.push(target.name);
                continue;
            }
            if (namesIn(working, into).has(normaliseName(target.name))) {
                throw new NmtsError(`Something called "${target.name}" is already in that folder.`, {
                    exitCode: 4,
                    nextStep: `Nothing was moved. Rename it first: nmts rename "${target.name}" <new name>`,
                });
            }
            const intent = { op: "move", id: target.id, parentId: into, at };
            intents.push(intent);
            working = applyIntent(working, intent);
            moved.push({ id: target.id, name: target.name });
        }
        outcome.moved = moved;
        outcome.already = already;
        outcome.parentId = into;
        return intents;
    });
    const shownDestination = normalisePath(destination);
    const where = shownDestination === "" ? "the top of the drive" : `"${shownDestination}"`;
    if (options.json) {
        const index = buildIndex(result.entries);
        say(JSON.stringify({
            moved: outcome.moved.map((m) => {
                const live = result.entries.find((e) => e.id === m.id);
                return { id: m.id, name: m.name, path: live === undefined ? null : fullPathOf(index, live) };
            }),
            already: outcome.already,
            parentId: outcome.parentId,
            changed: result.changed,
            reappliedAfterConflict: result.reappliedAfterConflict,
            seq: result.seq,
        }));
        return 0;
    }
    // ⛔ THE THINGS ARE NAMED, NOT COUNTED. "2 things moved" cannot disagree with what was written,
    //    so it could never catch a run that moved something the caller did not name.
    const names = outcome.moved.map((m) => `"${m.name}"`).join(", ");
    say(outcome.moved.length > 0
        ? `Moved ${names} to ${where}.`
        : `Everything named is already in ${where}. Nothing was moved.`);
    if (outcome.moved.length > 0 && outcome.already.length > 0) {
        say(`  ${outcome.already.map((n) => `"${n}"`).join(", ")} was already there.`);
    }
    if (result.changed && result.reappliedAfterConflict) {
        say(`  Another device wrote the file list first, so this was applied to that version.`);
    }
    return 0;
}
/** Give one thing a new name. The path stays the same otherwise. */
export async function rename(path, name, options = {}) {
    const say = options.write ?? say_;
    if (path === undefined || name === undefined || name.trim() === "") {
        throw new NmtsError("`nmts rename` needs what to rename and the new name.", {
            exitCode: 2,
            nextStep: `For example: nmts rename notes.txt "meeting notes.txt"`,
        });
    }
    if (name.includes("/")) {
        throw new NmtsError(`A name cannot contain "/" — that is what makes it a path.`, {
            exitCode: 2,
            nextStep: `To move it, use \`nmts mv\`. Nothing was renamed.`,
        });
    }
    const session = await openSession(options);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    const entries = list.manifest?.entries ?? [];
    const target = entryAt(entries, path, { nothingHappened: "Nothing was renamed." });
    const at = Date.now();
    const before = fullPathOf(buildIndex(entries), target);
    // ⛔ REFUSED RATHER THAN NUMBERED, AND THE REFUSAL IS RE-DECIDED ON EVERY ATTEMPT. An upload
    //    picks `report (2).pdf` because nobody was watching; a rename is somebody typing a name on
    //    purpose, and silently giving them a different one is how two files end up looking like a
    //    mistake nobody made. Checking once, before the write, was not enough: when another device
    //    took the name in between, the retry re-applied the old decision and produced two entries at
    //    one path, which no command in this tool can address afterwards (2026-08-23).
    const result = await applyToList(session, (now) => {
        const live = now.find((e) => e.id === target.id);
        if (live === undefined)
            return null;
        if (normaliseName(name) !== normaliseName(live.name) && namesIn(now, live.parentId).has(normaliseName(name))) {
            throw new NmtsError(`Something called "${name}" is already in that folder.`, {
                exitCode: 4,
                nextStep: "Nothing was renamed.",
            });
        }
        return { op: "rename", id: target.id, name, at };
    });
    return report(say, options, result.changed, result.reappliedAfterConflict, {
        text: result.changed ? `Renamed "${before}" to "${name}".` : `"${before}" is already called that.`,
        json: {
            id: target.id,
            from: target.name,
            to: name,
            changed: result.changed,
            reappliedAfterConflict: result.reappliedAfterConflict,
            seq: result.seq,
        },
    });
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
function report(say, options, changed, conflicted, out) {
    if (options.json) {
        say(JSON.stringify(out.json));
        return 0;
    }
    say(out.text);
    if (changed && conflicted) {
        say(`  Another device wrote the file list first, so this was applied to that version.`);
    }
    return 0;
}
