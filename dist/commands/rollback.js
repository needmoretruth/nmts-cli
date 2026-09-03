// `nmts rollback` — putting the version of the file list that came before back as the current one.
//
// ⛔ IT EXISTS FOR ONE SITUATION: the current list will not open, or opens as something that is
//    not this account's drive. A list that cannot be opened presents a full account as an empty
//    one, and the natural response to an empty account is to upload everything a second time. The
//    server retains the version each write replaced for exactly that day.
//
// ⛔ IT DOES NOT READ THE LIST, AND THAT IS THE POINT. Every other command here opens the sealed
//    blob before it does anything; this one moves bytes the server is holding from one place to
//    another and never looks inside them. A rollback that refused because the current list would
//    not open would refuse in the only case it is for.
//
// ⛔ WHAT IT COSTS: the newer version's additions leave the list. The BYTES are untouched — the
//    server still holds every row, the storage is still bought, and `nmts rebuild` finds files no
//    list names — but a name, a folder and the key that opens a file live in the list and nowhere
//    else, so a file added after the version being restored comes back nameless or not at all.
//
// ⛔ SO IT IS A PERSON'S ACT, IN EVERY MODE. This is not a decision about spending or about risk
//    that a person can hand to an agent in advance: it is a judgement that the drive somebody can
//    see is wrong, and nothing an unattended program reads can tell it that. There is no MCP tool
//    either, so this is the only door and it is shut from both sides.
import { request } from "../api.js";
import { currentMode } from "../autonomy.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { recordWrittenList } from "../manifest.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
function asVersion(value) {
    if (!isRecord(value)) {
        throw new NmtsError("The server's answer was not an object.", {
            nextStep: "Nothing was changed.",
        });
    }
    if (value["state"] === "absent")
        return { state: "absent" };
    if (value["state"] === "present" && typeof value["seq"] === "number" && typeof value["ct"] === "string") {
        return { state: "present", seq: value["seq"], ct: value["ct"] };
    }
    throw new NmtsError("The server answered with a file list this version cannot read.", {
        nextStep: "Nothing was changed. A newer version of this tool may understand it.",
    });
}
/** The one refusal for "there is nothing to go back to", whichever half of the pair is missing. */
function nothingRetained() {
    return new NmtsError("The server holds no previous version of the file list.", {
        exitCode: 4,
        nextStep: `Nothing was changed. \`${BINARY_NAME} rebuild\` builds a list from the server's rows when ` +
            `there is no list to go back to.`,
    });
}
export async function rollback(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // ⛔ BEFORE THE NETWORK, AND IN EVERY MODE. See the header: no setting can say on somebody's
    //    behalf that the drive they are looking at is the wrong one.
    if (currentMode() !== "off") {
        throw new NmtsError(`Rolling the file list back is a person's act.`, {
            exitCode: 5,
            nextStep: `Run \`${BINARY_NAME} rollback\` yourself, outside mode auto and without ` +
                `--skip-permissions.`,
        });
    }
    const session = await openSession({ server: options.server, network: options.network });
    const previous = asVersion(await request(session.server, "/v1/manifest/previous", { token: session.apiKey }));
    if (previous.state === "absent")
        throw nothingRetained();
    const current = asVersion(await request(session.server, "/v1/manifest", { token: session.apiKey }));
    // A current list with nothing before it is the same answer in different words: there is no
    // version this one replaced, so there is nothing to put back.
    if (current.state === "absent")
        throw nothingRetained();
    if (options.yes !== true) {
        // ⛔ THE UNCONFIRMED ANSWER SAYS WHAT WOULD HAPPEN IN ITS OWN WORDS, never in the words the
        //    finished act uses. A caller that read `restored_seq` off a run that changed nothing would
        //    report a rollback that never happened.
        if (options.json === true) {
            say(JSON.stringify({ previous_seq: previous.seq, current_seq: current.seq, changed: false }));
            return 5;
        }
        say(`Version ${previous.seq} of the file list would go back as the current one, over version ` +
            `${current.seq}.`);
        say(``);
        say(`⛔ What version ${current.seq} added is out of the list afterwards: a file's name, the`);
        say(`   folder it sits in and the key that opens it live in the list and nowhere else. The`);
        say(`   bytes are not touched — the storage stays bought — and \`${BINARY_NAME} rebuild\` finds`);
        say(`   files the list does not name.`);
        say(``);
        say(`Nothing was changed. To go ahead:  ${BINARY_NAME} rollback --yes`);
        say(`⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`);
        return 5;
    }
    // ⛔ THE SAME COMPARE-AND-SWAP EVERY OTHER WRITE USES, and it is not retried. A conflict here
    //    means somebody wrote the list while this ran, so what would be replaced is no longer the
    //    version this run showed the person — and re-applying it would roll back a version they
    //    never saw.
    const answer = await request(session.server, "/v1/manifest", {
        method: "PUT",
        token: session.apiKey,
        body: { base_seq: current.seq, ct: previous.ct },
    });
    const seq = isRecord(answer) ? answer["seq"] : undefined;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
        throw new NmtsError("The file list was written but the server did not say which version it is now.", {
            nextStep: `The older list is back. Run \`${BINARY_NAME} ls\` to see it.`,
        });
    }
    // This machine's own copy follows the server, so the next command does not treat what is now
    // being served as a list going backwards behind its back.
    await recordWrittenList(session.accountId, seq, previous.ct);
    if (options.json === true) {
        say(JSON.stringify({ restored_seq: previous.seq, replaced_seq: current.seq }));
        return 0;
    }
    say(`Put version ${previous.seq} of the file list back as the current one, over version ` +
        `${current.seq}. What version ${current.seq} added is out of the list now; the bytes are ` +
        `still stored, and \`${BINARY_NAME} rebuild\` finds files the list does not name.`);
    return 0;
}
