// `nmts star`, `nmts pin`, `nmts label` and the three commands that take those marks off again.
//
// ⛔ A MARK IS A DESIRED STATE, NEVER A TOGGLE, and that is the whole reason there are six verbs
//    rather than three with a switch. An edit that said "flip it" and was replayed onto a list
//    another device wrote first would flip twice: two people starring one file would end with it
//    unstarred, and neither of them did that. `star` means starred afterwards, whatever it was.
//
// ⛔ MARKS BELONG TO FILES. The drive lists starred FILES, counts labelled FILES, and lifts pinned
//    rows to the top of a folder — a folder row carries no mark at all. Putting one on a folder
//    would write a field into the sealed list that no screen anywhere draws, and the only way to
//    ever take it off again would be this tool. So a folder is refused, in words that say why.
//
// ⛔ AND NOT ONE OF THEM TELLS THE SERVER ANYTHING. A mark exists only inside the sealed list, so
//    there is no row to change and nothing to undo if the list write fails. What the server does
//    see is a manifest write of a known size at a known moment — the same as a rename.
//
// ⛔ ONE WRITE PER RUN, HOWEVER MANY PATHS. The intents these build take a set of ids for exactly
//    that reason. Writing once per path would be one lost compare-and-swap away from half a run.
import { buildIndex, fullPathOf, KIND_FILE } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { applyToList, batchTargets } from "../manifest-write.js";
import { openSession } from "../session.js";
/** Star one or more files: they show in the drive's favourites as well as in their own folder. */
export async function star(paths, options = {}) {
    return run("star", paths, undefined, options);
}
/** Take the star off. */
export async function unstar(paths, options = {}) {
    return run("unstar", paths, undefined, options);
}
/** Hold one or more files at the top of the folder they are in. */
export async function pin(paths, options = {}) {
    return run("pin", paths, undefined, options);
}
/** Let them fall back into the ordinary order. */
export async function unpin(paths, options = {}) {
    return run("unpin", paths, undefined, options);
}
/**
 * Put one label on one or more files.
 *
 * ⚠ A LABEL EXISTS EXACTLY AS LONG AS SOME FILE WEARS IT. There is no registry to add it to and
 *   none to clean up: two devices inventing the same label converge on it instead of colliding,
 *   and the last `unlabel` is what makes it stop existing.
 */
export async function label(name, paths, options = {}) {
    return run("label", paths, name, options);
}
/** Take one label off one or more files. */
export async function unlabel(name, paths, options = {}) {
    return run("unlabel", paths, name, options);
}
/**
 * `nmts label --rename <old> <new>` — one label's name, changed on every file that wears it.
 *
 * ⛔ IT IS A SWEEP, AND IT NAMES NO PATHS. A label has no registry to rename it in (see `label`
 *    above): it exists on the files, so renaming it means touching every file that wears it. That
 *    is why this is a different entry point rather than a switch on `label` — one takes the files
 *    it is given, and this one takes whatever the account holds.
 *
 * ⛔ RENAMING ONTO A LABEL THAT ALREADY EXISTS MERGES THE TWO. A file wearing both would otherwise
 *    end up wearing one label twice, which shows a doubled row and counts the file twice. The
 *    intent does that; it is written down here because it is the behaviour somebody has to be able
 *    to predict before typing this.
 */
export async function labelRename(from, to, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // ⚠ Trimmed here as well as inside the intent, so the text compared against what a file wears
    //   is the same text that gets stored. `  work  ` and `work` are one label.
    const old = from === undefined ? "" : from.trim();
    const fresh = to === undefined ? "" : to.trim();
    if (old === "" || fresh === "") {
        throw new NmtsError("`nmts label --rename` needs the label to rename, then its new name.", {
            exitCode: 2,
            nextStep: "For example: nmts label --rename work archive",
        });
    }
    const session = await openSession(options);
    const at = Date.now();
    let files = 0;
    // ⛔ COUNTED INSIDE THE ATTEMPT, like every other question about the list. On a lost
    //    compare-and-swap the list is read again, and how many files wear a label is a fact about
    //    the version that was read — another device may have added one since.
    await applyToList(session, (now) => {
        files = now.filter((e) => (e.labels ?? []).includes(old)).length;
        return { op: "labelRename", from: old, to: fresh, at };
    });
    if (options.json) {
        say(JSON.stringify({ label: old, renamed_to: fresh, files }));
        return 0;
    }
    if (files === 0) {
        say(`No file carries the label "${old}".`);
        return 0;
    }
    say(`Renamed the label "${old}" to "${fresh}" on ${files} ${files === 1 ? "file" : "files"}.`);
    return 0;
}
/**
 * `nmts unlabel <name> --all` — one label, taken off every file that wears it.
 *
 * ⛔ THIS IS WHAT MAKES A LABEL STOP EXISTING, and it is the whole reason the sweep is worth a
 *    flag: a label with no registry can only be removed by finding every file wearing it, and
 *    doing that by hand is how one file keeps a label nobody can see any more.
 */
export async function unlabelAll(name, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const text = name === undefined ? "" : name.trim();
    if (text === "") {
        throw new NmtsError("`nmts unlabel --all` needs the label to take off.", {
            exitCode: 2,
            nextStep: "For example: nmts unlabel work --all",
        });
    }
    const session = await openSession(options);
    const at = Date.now();
    let files = 0;
    await applyToList(session, (now) => {
        files = now.filter((e) => (e.labels ?? []).includes(text)).length;
        return { op: "labelDelete", label: text, at };
    });
    if (options.json) {
        say(JSON.stringify({ label: text, removed_from: files }));
        return 0;
    }
    if (files === 0) {
        say(`No file carries the label "${text}".`);
        return 0;
    }
    say(`Took the label "${text}" off ${files} ${files === 1 ? "file" : "files"}.`);
    return 0;
}
async function run(verb, paths, name, options) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const on = !verb.startsWith("un");
    const wantsLabel = verb === "label" || verb === "unlabel";
    // ⚠ Trimmed HERE as well as inside the intent, so the label that is compared against what a
    //   file already wears is the same text that gets stored. `  work  ` and `work` are one label.
    const text = name === undefined ? "" : name.trim();
    if (wantsLabel && text === "") {
        throw new NmtsError(`\`nmts ${verb}\` needs the label first, then what to put it on.`, {
            exitCode: 2,
            nextStep: `For example: nmts ${verb} work notes.txt report.pdf`,
        });
    }
    if (paths.length === 0) {
        throw new NmtsError(`\`nmts ${verb}\` needs the path of at least one file.`, {
            exitCode: 2,
            nextStep: `\`nmts ls\` prints the paths as this expects them.`,
        });
    }
    const session = await openSession(options);
    const at = Date.now();
    const outcome = { marked: [], already: [] };
    // ⛔ WHICH FILES THESE PATHS NAME IS ASKED INSIDE THE ATTEMPT, not before it. On a lost
    //    compare-and-swap the list is read again, and a path is a question about the list: the
    //    winner may have renamed something, or moved it, or put it in the trash. Deciding once and
    //    re-applying would mark whatever now happens to be sitting at that id.
    const result = await applyToList(session, (now) => {
        const index = buildIndex(now);
        const targets = batchTargets(now, paths, { nothingHappened: "Nothing was marked." });
        const marked = [];
        const already = [];
        for (const target of targets) {
            if (target.kind !== KIND_FILE) {
                throw new NmtsError(`"${fullPathOf(index, target)}" is a folder, and marks are for files.`, {
                    exitCode: 4,
                    nextStep: `Nothing was marked. A star, a pin and a label are shown on files; a folder that ` +
                        `carried one would show it nowhere.`,
                });
            }
            (wears(target, verb, text) === on ? already : marked).push(fullPathOf(index, target));
        }
        outcome.marked = marked;
        outcome.already = already;
        // ⛔ EVERY ID GOES IN, including the ones already like this. The intent is a desired state, so
        //    the ones already in it change nothing — and when they are ALL already in it the whole
        //    edit is a no-op, which costs no version bump and no download on anybody else's device.
        return intentFor(verb, targets.map((t) => t.id), text, on, at);
    });
    if (options.json) {
        say(JSON.stringify({
            mark: wantsLabel ? "label" : verb === "star" || verb === "unstar" ? "favorite" : "pinned",
            on,
            label: wantsLabel ? text : null,
            marked: outcome.marked,
            already: outcome.already,
            changed: result.changed,
            reappliedAfterConflict: result.reappliedAfterConflict,
            seq: result.seq,
        }));
        return 0;
    }
    // ⛔ THE FILES ARE NAMED, NOT COUNTED, like every other edit in this tool: "2 files starred"
    //    cannot disagree with what was written, so it could never catch a run that marked something
    //    the caller did not name.
    const names = (list) => list.map((p) => `"${p}"`).join(", ");
    if (outcome.marked.length > 0) {
        say(`${did(verb, text)} ${names(outcome.marked)}.`);
        if (outcome.already.length > 0) {
            say(`  ${names(outcome.already)} ${outcome.already.length === 1 ? "was" : "were"} already ${state(verb, text)}.`);
        }
    }
    else {
        say(`Nothing changed: ${names(outcome.already)} ` +
            `${outcome.already.length === 1 ? "is" : "are"} already ${state(verb, text)}.`);
    }
    if (result.changed && result.reappliedAfterConflict) {
        say(`  Another device wrote the file list first, so this was applied to that version.`);
    }
    return 0;
}
/** The intent one verb writes. `on` is the state asked for, never a flip — see the header. */
function intentFor(verb, ids, text, on, at) {
    if (verb === "star" || verb === "unstar")
        return { op: "favorite", ids, on, at };
    if (verb === "pin" || verb === "unpin")
        return { op: "pin", ids, on, at };
    return { op: "label", ids, label: text, on, at };
}
/** Does this entry already carry the mark the verb is about? */
function wears(entry, verb, text) {
    if (verb === "star" || verb === "unstar")
        return entry.favorite === true;
    if (verb === "pin" || verb === "unpin")
        return entry.pinned === true;
    return (entry.labels ?? []).includes(text);
}
/** What the run did, as the first word of the sentence saying it. */
function did(verb, text) {
    if (verb === "star")
        return "Starred";
    if (verb === "unstar")
        return "Took the star off";
    if (verb === "pin")
        return "Pinned";
    if (verb === "unpin")
        return "Unpinned";
    if (verb === "label")
        return `Put "${text}" on`;
    return `Took "${text}" off`;
}
/** The state the verb asks for, for the sentence about what was already the case. */
function state(verb, text) {
    if (verb === "star")
        return "starred";
    if (verb === "unstar")
        return "not starred";
    if (verb === "pin")
        return "pinned";
    if (verb === "unpin")
        return "not pinned";
    if (verb === "label")
        return `wearing "${text}"`;
    return `without "${text}"`;
}
