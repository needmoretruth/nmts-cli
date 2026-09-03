// `nmts losses` — the storage bought with this account's credits that the chain no longer knows.
//
// ⛔ IT REPORTS, IT DOES NOT REPAIR. Once the chain has stopped serving a storage object nothing
//    this tool or the server does brings the bytes back, and the row is the record of a purchase
//    that produced nothing. What the command is for is that somebody finds out from us rather
//    than from a download that stops coming back.
//
// ⛔ THERE IS NO FILE NAME AND THERE CANNOT BE ONE. The answer names on-chain STORAGE OBJECTS; the
//    pairing that would resolve one to a file is server-side, has no route, and the drive's own
//    list is sealed with a key the server never sees. Printing a guessed name would be worse than
//    printing none, so the line prints the public object id and says why that is all there is.
//
// ⚠ AN EMPTY LIST IS NOT "NOTHING IS GONE". The daily round samples fifty objects at random, so an
//   object nobody has drawn yet has not been asked about. The route's own note says a client must
//   not print the second sentence, and the wording here does not.
//
// ⛔ THE THREE ACTS ARE ONE COMMAND BECAUSE THEY ARE ONE SUBJECT, and exactly one of them runs per
//    call. Re-checking asks the chain the same question the daily round asks, now. Dismissing is a
//    person saying they have read the line — see the mode check below, which is the reason this
//    command imports the autonomy module at all.
import { request, ServerError } from "../api.js";
import { currentMode } from "../autonomy.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
/**
 * The refusal for an id this account holds no line for.
 *
 * ⛔ ONE TEXT FOR BOTH ARMS. The server answers 404 to a re-check and to a dismiss for the same
 *    reason — the account does not hold that loss — and two wordings for one cause is how a caller
 *    ends up branching on which command it happened to run.
 */
function noSuchLine(id) {
    return new NmtsError(`NMTS holds no loss line for ${id} on this account.`, {
        exitCode: 4,
        nextStep: `Run \`${BINARY_NAME} losses\` to see the lines that exist.`,
    });
}
/** `unknown` off the wire, read as the rows the route declares. */
function rowsOf(answer) {
    const list = isRecord(answer) ? answer["losses"] : undefined;
    if (!Array.isArray(list)) {
        throw new NmtsError(`The server's answer did not carry a list of losses.`, {
            exitCode: 1,
            nextStep: `Nothing was changed. Report it rather than retrying — the shape, not the network, is wrong.`,
        });
    }
    return list.map((row) => {
        const id = isRecord(row) ? row["blob_object_id"] : undefined;
        const seen = isRecord(row) ? row["first_seen"] : undefined;
        const notice = isRecord(row) ? row["required_notice"] : undefined;
        const restricted = isRecord(row) ? row["restricted"] : undefined;
        if (typeof id !== "string" || typeof seen !== "string") {
            throw new NmtsError(`The server listed a loss this version cannot read.`, {
                exitCode: 1,
                nextStep: `Nothing was changed. A newer version of this tool may understand it.`,
            });
        }
        // ⚠ A flag that did not arrive as a boolean is read as false, and that is the only place here
        //   where a missing field is filled in: both mean "this line carries no extra sentence", and
        //   the sentences they add are additions to a line that is already correct without them.
        return {
            blob_object_id: id,
            first_seen: seen,
            required_notice: notice === true,
            restricted: restricted === true,
        };
    });
}
/** The UTC day of an RFC 3339 instant, `YYYY-MM-DD`. */
function utcDay(instant) {
    const at = new Date(instant);
    if (Number.isNaN(at.getTime())) {
        throw new NmtsError(`The server dated a loss with something that is not a time.`, {
            exitCode: 1,
            nextStep: `Nothing was changed. Report it rather than retrying.`,
        });
    }
    return at.toISOString().slice(0, 10);
}
export async function losses(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (options.recheck !== undefined && options.dismiss !== undefined) {
        throw new NmtsError(`--recheck and --dismiss are two different acts, and one run does one.`, {
            exitCode: 2,
            nextStep: `Run one, read what it says, then run the other.`,
        });
    }
    // ⛔ TAKING A LINE OFF IS A PERSON'S ACT, AND A MODE IS THE OPPOSITE OF ONE. Every other refusal
    //    a mode meets is a refusal a mode LIFTS: the person wrote down that an agent may decide for
    //    them. This one is not a decision about spending or about risk — it is somebody saying "I
    //    have read this", and no setting can say that on their behalf. There is no MCP tool for it
    //    either, so this is the only door and it is shut from both sides.
    if (options.dismiss !== undefined && currentMode() !== "off") {
        throw new NmtsError(`A loss line comes off after a person has read it.`, {
            exitCode: 5,
            nextStep: `Run \`${BINARY_NAME} losses --dismiss ${options.dismiss}\` yourself, outside mode auto ` +
                `and without --skip-permissions.`,
        });
    }
    const session = await openSession({ server: options.server, network: options.network });
    if (options.recheck !== undefined) {
        const id = options.recheck;
        let answer;
        try {
            answer = await request(session.server, "/v1/storage-loss/recheck", {
                token: session.apiKey,
                method: "POST",
                body: { blob_object_id: id },
            });
        }
        catch (error) {
            if (error instanceof ServerError && error.status === 404)
                throw noSuchLine(id);
            throw error;
        }
        const result = isRecord(answer) ? answer["result"] : undefined;
        if (result !== "found" && result !== "still_missing" && result !== "unread") {
            throw new NmtsError(`The server answered the re-check with something this version cannot read.`, {
                exitCode: 1,
                nextStep: `Nothing was decided about the storage. A newer version of this tool may understand it.`,
            });
        }
        const said = result;
        if (options.json === true) {
            say(JSON.stringify({ blob_object_id: id, result: said }));
            return 0;
        }
        if (said === "found")
            say(`The chain knows ${id} again. Its line came off.`);
        else if (said === "still_missing")
            say(`The chain still does not know ${id}. The line stays.`);
        else
            say(`The chain could not be read just now. Nothing changed.`);
        return 0;
    }
    if (options.dismiss !== undefined) {
        const id = options.dismiss;
        try {
            await request(session.server, `/v1/storage-loss/${encodeURIComponent(id)}`, {
                token: session.apiKey,
                method: "DELETE",
            });
        }
        catch (error) {
            if (error instanceof ServerError && error.status === 404)
                throw noSuchLine(id);
            throw error;
        }
        if (options.json === true) {
            say(JSON.stringify({ blob_object_id: id, dismissed: true }));
            return 0;
        }
        say(`Took the line for ${id} off. The incident stays in a record that names nobody; if the same ` +
            `storage is found and lost again, it is shown again.`);
        return 0;
    }
    const answer = await request(session.server, "/v1/storage-loss", { token: session.apiKey });
    if (options.json === true) {
        // ⛔ THE SERVER'S OBJECT, UNCHANGED. A reader of this arm is reading the route, and a shape
        //    rewritten here would be a second wire to keep in step with the first.
        say(JSON.stringify(answer));
        return 0;
    }
    const rows = rowsOf(answer);
    if (rows.length === 0) {
        say(`The daily check has found nothing missing for this account.`);
        say(`It samples the storage NMTS bought with your credits once a day and asks the chain whether ` +
            `it is still there.`);
        return 0;
    }
    say(rows.length === 1
        ? `The chain no longer knows one storage object your credits paid for. That is what the ` +
            `check measured; it did not try the download. The file may no longer come back, and ` +
            `NMTS cannot restore it.`
        : `The chain no longer knows ${rows.length} storage objects your credits paid for. That is ` +
            `what the check measured; it did not try the download. Those files may no longer come ` +
            `back, and NMTS cannot restore them.`);
    say(``);
    for (const row of rows) {
        say(`${row.blob_object_id}  first missed ${utcDay(row.first_seen)}` +
            (row.required_notice ? ` · shown because the law requires it` : ``) +
            (row.restricted ? ` · kept but not used while you contest it` : ``));
    }
    say(``);
    say(`The date is when a check first could not find it, not when the storage went. There is no ` +
        `file name: the server cannot pair the object with a file, and NMTS cannot see inside files.`);
    say(`\`${BINARY_NAME} losses --recheck <id>\` asks the chain again now. \`${BINARY_NAME} losses ` +
        `--dismiss <id>\` takes a line off once you have read it; the incident stays in a record ` +
        `that names nobody.`);
    return 0;
}
