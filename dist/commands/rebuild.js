// `nmts rebuild` — building a file list for an account that has none.
//
// ⛔ IT IS ITS OWN COMMAND, AND IT ASKS. Rebuilding WRITES: it seals a new file list and puts it on
//    the server, and from then on that account's names are placeholders on every device. Doing
//    that as a side effect of `ls` would mean somebody who pointed this tool at the wrong account
//    — a mistyped variable, a second code on the same machine — would come back to an account that
//    had been rebuilt without anybody deciding to. So it is a verb somebody types, and a run
//    without `--yes` reports exactly what would happen and changes nothing.
//
// ⛔ AND IT IS NOT A ONCE-PER-MACHINE AGREEMENT. Those fit a capability — this machine may spend,
//    this machine may hold the code unsealed. What is being decided here is not "may this tool
//    ever rebuild" but "is THIS account, today, the one whose list is missing", and an answer
//    given once for every future account on this machine is not an answer to that question.
//
// ⛔ TWO THINGS STOP IT FROM WRITING OVER A LIST, and they fail differently on purpose:
//      · it reads the list first, and an account that has one is refused before the account is
//        listed at all;
//      · the write itself declares `base_seq: null`, which the server accepts only while no list
//        exists — so a list that appears while this runs comes back as a refusal rather than as a
//        replacement.
//
// ⚠ A THIRD CASE IS NOT A MISSING LIST AT ALL: this machine has a record of a list for this
//   account and the server now says there is none. That is a list that WENT missing — the shape a
//   server would take to make a device throw away its real names — so it stops, and `--force` is
//   how somebody who knows their list was genuinely lost goes ahead anyway.
import { NmtsError } from "../errors.js";
import { createFirstList } from "../manifest-create.js";
import { readFileList } from "../manifest.js";
import { BINARY_NAME } from "../product.js";
import { rebuildFromServer } from "../rebuild.js";
import { openSession } from "../session.js";
import { TRASH_RETENTION_DAYS } from "../trash-sweep.js";
/** The machine-readable answer, printed once on whichever path the run takes. */
function summary(built, wrote, extra = {}) {
    return JSON.stringify({
        entries: built.entries.length,
        live: built.live,
        trashed: built.trashed,
        keyless: built.keyless,
        unaccounted: built.unaccounted,
        namesRecovered: false,
        foldersRecovered: false,
        wrote,
        ...extra,
    });
}
export async function rebuild(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const session = await openSession(options);
    const current = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (current.manifest !== null) {
        throw new NmtsError(`This account already has a file list (version ${current.seq ?? 0}).`, {
            exitCode: 4,
            nextStep: `Nothing was changed. Rebuilding is for an account whose list is missing; over an existing ` +
                `one it would replace real names with placeholders. Run \`${BINARY_NAME} ls\` to see what ` +
                `the list holds.`,
        });
    }
    if (!current.firstTimeOnThisMachine && options.force !== true) {
        throw new NmtsError(`This machine has seen a file list for this account, and the server now says there is none.`, {
            exitCode: 4,
            nextStep: `Nothing was changed. A list that was there and is not is different from one that never ` +
                `existed: it is also what being shown an emptied account would look like. Open the account ` +
                `in a browser and check before rebuilding. If the list really was lost, ` +
                `\`${BINARY_NAME} rebuild --yes --force\` goes ahead.`,
        });
    }
    // ⚠ A LARGE ACCOUNT IS TWO WHOLE LISTINGS, a hundred rows at a time, and a person watching a
    //   command that says nothing for a minute concludes it has hung. Every thousandth row is often
    //   enough to show movement and rare enough not to bury what comes after it. The machine-readable
    //   run stays silent: its output is one object, and a progress line on that stream would break it.
    let announced = 0;
    const built = await rebuildFromServer({
        server: session.server,
        apiKey: session.apiKey,
        onProgress: (read) => {
            if (options.json === true || read < announced + 1000)
                return;
            announced = read;
            say(`  read ${read} stored files so far...`);
        },
    });
    if (built.entries.length === 0) {
        if (options.json) {
            say(summary(built, false));
            return 0;
        }
        say(`This account has no file list, and the server holds no stored files for it either.`);
        say(`There is nothing to rebuild from. Nothing was changed.`);
        return 0;
    }
    if (options.yes !== true) {
        if (options.json) {
            say(summary(built, false));
            return 5;
        }
        describe(say, built);
        say(``);
        say(`Nothing was changed. To go ahead:  ${BINARY_NAME} rebuild --yes`);
        say(`⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`);
        return 5;
    }
    const written = await createFirstList(session, built.entries);
    if (options.json) {
        say(summary(built, true, { seq: written.seq }));
        return 0;
    }
    say(`Wrote file list version ${written.seq}: ${built.entries.length} ` +
        `entr${built.entries.length === 1 ? "y" : "ies"} (${built.live} live, ${built.trashed} in the trash).`);
    say(``);
    say(`  Every file is at the top of the drive under a placeholder name — the server had no name,`);
    say(`  no folder and no placement to give back.`);
    say(`  \`${BINARY_NAME} ls\` shows them; \`${BINARY_NAME} rename\` and \`${BINARY_NAME} mv\` put them back.`);
    reportGaps(say, built);
    return 0;
}
/** What a rebuild would do, in the words somebody is about to decide on. */
function describe(say, built) {
    say(`This account has no file list, and the server still holds ${built.entries.length} ` +
        `stored file${built.entries.length === 1 ? "" : "s"} for it. The files are there; what is ` +
        `missing is the list that names them.`);
    say(``);
    say(`A rebuild would recover:`);
    say(`  · ${built.live} live and ${built.trashed} in the trash — the trash keeps its remaining days`);
    say(`  · every file's key, without which its bytes could never be opened again`);
    say(`  · the sealed content hash, so a later download still checks itself`);
    say(`  · each file's real dates and its size`);
    say(``);
    say(`It cannot recover:`);
    say(`  · names — each file gets a placeholder such as \`recovered-a1b2c3d4\`, for you to type over`);
    say(`  · folders and where each file sat — the rebuilt drive is flat`);
    say(`  · stars, labels, share receipts and account settings`);
    say(``);
    say(`  None of that is a fault: the server was built not to know it. It keeps a row per stored`);
    say(`  file and the key that opens it, and nothing about what the file is called.`);
    reportGaps(say, built);
}
/** The parts of the account this rebuild could not account for. Printed on both paths. */
function reportGaps(say, built) {
    if (built.keyless > 0) {
        say(``);
        say(`  ⚠ ${built.keyless} of them carr${built.keyless === 1 ? "ies" : "y"} no key on the server.` +
            ` ${built.keyless === 1 ? "It appears" : "They appear"} in the list and`);
        say(`    nothing can open ${built.keyless === 1 ? "it" : "them"} — the entry is still what says the file was there.`);
    }
    if (built.unaccounted === null) {
        say(``);
        say(`  ⚠ The check that compares this against everything the server holds could not be`);
        say(`    finished, so this cannot say whether any row was left out.`);
        return;
    }
    if (built.unaccounted > 0) {
        say(``);
        say(`  ⚠ ${built.unaccounted} row${built.unaccounted === 1 ? "" : "s"} the server holds ` +
            `${built.unaccounted === 1 ? "is" : "are"} not in this rebuild.`);
        say(`    The trash listing ends at ${TRASH_RETENTION_DAYS} days, so anything thrown away longer ago than that`);
        say(`    is in no listing this can read, and its key is not recoverable here. The bytes stay`);
        say(`    on the storage network until the term already paid for runs out.`);
    }
}
