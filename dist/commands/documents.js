// `nmts notices`, `nmts terms`, `nmts privacy` — the three documents a person is owed, read from
// the terminal instead of from a browser.
//
// ⛔ WHY A COMMAND-LINE TOOL NEEDS THEM. The notice board is where an interruption, an incident,
//    and the seven-day warning before a new version of the Terms takes effect are posted, and the
//    Terms and the Privacy Policy are the documents an account is held to. Until now all three
//    lived only on screens. An account driven from a terminal — which is most of what this tool
//    is for — could be governed by a document it had no way to read, and told about a change it
//    had no way to see. That is the whole reason these exist.
//
// ⛔ THEY ASK FOR NOTHING AND CARRY NOTHING. No NMTS key, no API key, no session: these are
//    public documents and the routes serving them are public. Nothing here opens a session, so
//    reading the terms cannot fail because a credential is stale, and reading them says nothing
//    to the server about who read them.
//
// ⛔ THE BYTES ARE THE BROWSER'S BYTES. `--save` writes what the server sends under the name the
//    server's own `Content-Disposition` gives it — the same name and the same bytes the browser's
//    download button produces. A copy kept from here and a copy kept from a screen are the same
//    file, which is what makes either one worth keeping.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { HttpError, request } from "../api.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { BINARY_NAME } from "../product.js";
import { destinationFor } from "../safe-path.js";
import { resolveServer } from "../server.js";
/** The three ids `GET /api/legal/{id}` serves, and the two the command line names. */
const LEGAL_IDS = { terms: "terms", privacy: "privacy", board: "board-terms" };
/**
 * The three verbs, dispatched from one module.
 *
 * ⛔ ONE ENTRY POINT BECAUSE THEY ARE ONE SUBJECT — the documents this service publishes — and
 *    because every command in `main.ts` is loaded only when it is the command being run. Three
 *    entries there would be three imports to keep in step for one file.
 */
export async function runDocuments(command, options) {
    if (command === "notices")
        return await notices(options);
    return await legal(command === "terms" ? "terms" : "privacy", options);
}
// ── The notice board ────────────────────────────────────────────────────────────────────────
/**
 * `nmts notices` — the board, one notice, or one notice kept as a file.
 *
 * The id, when there is one, is the operand: `nmts notices <id>` prints it and
 * `nmts notices --save <id>` writes it. With no id the command lists.
 */
export async function notices(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const base = resolveServer(options.server);
    const id = options.id;
    if (id === undefined) {
        if (options.save === true) {
            throw new NmtsError("Say which notice to save.", {
                exitCode: 2,
                nextStep: `\`${BINARY_NAME} notices --save <id>\`. Run \`${BINARY_NAME} notices\` to see the ids.`,
            });
        }
        return await listNotices(base, options, say);
    }
    const answer = await noticeBody(base, id);
    if (options.save !== true) {
        say(answer.text.replace(/\n$/u, ""));
        return 0;
    }
    say(`Wrote ${keep(answer, options.out)}`);
    return 0;
}
async function listNotices(base, options, say) {
    const answer = await request(base, "/api/notices");
    if (options.json === true) {
        say(JSON.stringify(answer));
        return 0;
    }
    const rows = noticeRows(answer);
    if (rows.length === 0) {
        say("No notices have been posted.");
        return 0;
    }
    for (const row of rows)
        say(`${row.date}  ${row.id}  ${row.title}`);
    say("");
    say(`Read one with \`${BINARY_NAME} notices <id>\`, or keep it as a dated file with ` +
        `\`${BINARY_NAME} notices --save <id>\`.`);
    return 0;
}
/**
 * The rows of the feed, read as the route declares them.
 *
 * ⛔ THE TITLE IS TAKEN FROM THE ENGLISH SIDE and the row is skipped when there is no id or date,
 *    rather than printed with a blank where one should be. A line missing the id is a line nobody
 *    can act on, and printing it invites a person to ask this tool for a notice by a name it will
 *    refuse.
 */
function noticeRows(answer) {
    const list = isRecord(answer) ? answer["notices"] : undefined;
    if (!Array.isArray(list)) {
        throw new NmtsError("The server's answer did not carry a list of notices.", {
            exitCode: 1,
            nextStep: "Report it rather than retrying — the shape, not the network, is wrong.",
        });
    }
    const rows = [];
    for (const row of list) {
        if (!isRecord(row))
            continue;
        const id = row["id"];
        const date = row["date"];
        const title = isRecord(row["title"]) ? row["title"]["en"] : undefined;
        if (typeof id !== "string" || typeof date !== "string")
            continue;
        rows.push({ id, date, title: typeof title === "string" ? title : "" });
    }
    return rows;
}
/** One notice's text, with a refusal that names the way to find the ids that exist. */
async function noticeBody(base, id) {
    try {
        return await request(base, `/api/notices/${encodeURIComponent(id)}`, { as: "text" });
    }
    catch (error) {
        // ⛔ ONLY A 404 BECOMES THIS REFUSAL. A network failure or a proxy's error page is a different
        //    problem with a different remedy, and telling somebody to check the id when the server was
        //    unreachable sends them looking in the wrong place.
        if (error instanceof HttpError && error.status === 404) {
            throw new NmtsError(`No notice has been posted with the id ${id}.`, {
                exitCode: 4,
                nextStep: `Run \`${BINARY_NAME} notices\` to see the notices there are, with their ids.`,
            });
        }
        throw error;
    }
}
// ── The Terms and the Privacy Policy ────────────────────────────────────────────────────────
/** `nmts terms` and `nmts privacy` — the published document, printed or kept. */
export async function legal(which, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const base = resolveServer(options.server);
    const lang = languageOf(options.lang);
    if (options.board === true && which !== "terms") {
        throw new NmtsError("--board belongs to the terms, not the privacy policy.", {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} terms --board\` is the message board's terms. \`${BINARY_NAME} privacy\` has one document.`,
        });
    }
    const id = options.board === true ? LEGAL_IDS.board : LEGAL_IDS[which];
    const answer = await request(base, `/api/legal/${id}?lang=${lang}`, { as: "text" });
    if (options.save !== true) {
        say(answer.text.replace(/\n$/u, ""));
        return 0;
    }
    say(`Wrote ${keep(answer, options.out)}`);
    return 0;
}
/**
 * Which language to ask for.
 *
 * ⛔ IT REFUSES RATHER THAN FALLING BACK. The route treats anything that is not `ko` as English,
 *    so a typo would silently hand somebody the wrong document while looking like it worked — and
 *    the two versions of a legal document are not interchangeable to whoever is reading one.
 */
function languageOf(lang) {
    if (lang === undefined || lang === "en")
        return "en";
    if (lang === "ko")
        return "ko";
    throw new NmtsError(`This tool does not have a version in "${lang}".`, {
        exitCode: 2,
        nextStep: "--lang takes en or ko. English is the canonical text.",
    });
}
// ── Keeping a copy ──────────────────────────────────────────────────────────────────────────
/**
 * Write a document out under the name the server gave it, never over something already there.
 *
 * ⛔ IT DOES NOT REPLACE, AND THERE IS NO --force. These files carry a version and a date in their
 *    names, so two documents never want the same one: a name already taken means the same document
 *    is already kept, and quietly rewriting it would destroy a copy somebody kept on purpose — the
 *    copy that says what they were told and when.
 */
function keep(answer, out) {
    if (answer.filename === null) {
        throw new NmtsError("The server did not say what to call this document.", {
            exitCode: 1,
            nextStep: "Nothing was written. Print it instead and redirect it to a name of your choosing.",
        });
    }
    const directory = out === undefined ? process.cwd() : isAbsolute(out) ? out : resolve(process.cwd(), out);
    if (existsSync(directory) && !statSync(directory).isDirectory()) {
        throw new NmtsError(`${directory} is a file, and --out names the directory to write into.`, {
            exitCode: 2,
            nextStep: `Nothing was written. Pass --out with a directory, or leave it out to write into ${process.cwd()}.`,
        });
    }
    // The name came over the network; this is what contains it to the chosen directory.
    const destination = destinationFor(directory, answer.filename);
    try {
        writeFileSync(destination, answer.text, { flag: "wx" });
    }
    catch (error) {
        if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
            throw new NmtsError(`${destination} is already there.`, {
                exitCode: 4,
                nextStep: `Nothing was written, and the copy already there was not touched. Pass --out to write ` +
                    `into another directory, or move that file aside.`,
            });
        }
        throw error;
    }
    return destination;
}
