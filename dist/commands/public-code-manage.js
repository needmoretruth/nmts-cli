// `nmts public-code list · new · revoke` — the account's numbered public codes.
//
// ⛔ WHAT IS PRINTED IS WHAT THIS KEY DERIVES, CHECKED AGAINST WHAT THE SERVER HOLDS. Each code is
//    derived here at its number and compared with the server's address; a difference stops the
//    command with the bigger fact (`differentCode`), because a person gives these out and a code the
//    key does not make is somebody else's.
//
// ⛔ REVOKING NEVER HAPPENS WITHOUT A YES. `revoke` and `new --replace` are the one high act here
//    (`risk.ts` "public-code.revoke"); the question names the code, and without a terminal it is
//    `--yes` or nothing.
//
// ⚠ THE CEILINGS ARE THE SERVER'S. Three live codes, one for a Platform user, and a daily number
//   that is smaller for an agent: this prints what the server answered and does not keep a copy.
import { toBase64Url } from "../bytes.js";
import { loadCrypto } from "../crypto.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { promptLine, stdinIsATerminal } from "../prompt.js";
import { codeActivity } from "../public-code-activity.js";
import { codeNumber, differentCode, lastLiveCode, notLiveCode, publicCodeRefusal } from "../public-code-refusals.js";
import { defaultCode, liveCodes, nextCodeIndex, publishCode, readPublicCodes, revokeCode, } from "../public-codes.js";
import { openSession } from "../session.js";
import { shareKeyRing, shareKeysAt } from "../share-codes.js";
/** The code this key derives at `row`'s number, as a person reads it — or `differentCode` when the server's differs. */
export function checkedDisplay(crypt, code, row) {
    const keys = shareKeysAt(crypt, code, row.index);
    try {
        if (toBase64Url(keys.address) !== row.address)
            throw differentCode();
        return keys.display;
    }
    finally {
        keys.wipe();
    }
}
/** `checkedDisplay` for every row, from one ring — the key's derivation runs once, not once per row. */
function checkedDisplays(ring, rows) {
    return new Map(rows.map((row) => {
        const keys = ring.at(row.index);
        if (toBase64Url(keys.address) !== row.address)
            throw differentCode();
        return [row.index, keys.display];
    }));
}
/** The UTC day of an instant, `YYYY-MM-DD`; the text as sent when it is not one. */
function day(instant) {
    const at = new Date(instant);
    return Number.isNaN(at.getTime()) ? instant : at.toISOString().slice(0, 10);
}
function rowLine(row, display, isDefault) {
    const counts = `sent ${row.sent} · received ${row.received} · messages ${row.support}`;
    if (row.revokedAt !== null)
        return `#${row.index}  ${display}  revoked ${day(row.revokedAt)}  ${counts}`;
    return `#${row.index}  ${display}${isDefault ? "  default" : ""}  made ${day(row.createdAt)}  ${counts}`;
}
function activityLines(activity) {
    const out = [];
    for (const s of activity?.sent ?? []) {
        const what = s.path ?? `${s.itemId} (no longer in the file list)`;
        const gone = s.recipientRevoked ? "  · the recipient has revoked this code" : "";
        out.push(`    sent      ${what}  to ${s.recipient}  ${day(s.createdAt)}  share ${s.id}${gone}`);
    }
    for (const r of activity?.received ?? []) {
        if (r.problem !== null) {
            out.push(`    received  share ${r.id}  (will not open: ${r.problem})`);
            continue;
        }
        const gone = r.senderRevoked ? "  · the sender has revoked this code" : "";
        out.push(`    received  ${r.name ?? ""}  from ${r.sender ?? ""}  ${day(r.createdAt)}  share ${r.id}${gone}`);
    }
    return out;
}
function sayer(options) {
    return options.write ?? ((line) => process.stdout.write(`${line}\n`));
}
/** `nmts public-code list [--activity]` — every code, live ones first, and the two ceilings. */
export async function listCodes(options = {}) {
    const say = sayer(options);
    const session = await openSession({ server: options.server, network: options.network });
    const crypt = await loadCrypto();
    const door = { server: session.server, token: session.apiKey };
    const list = await readPublicCodes(door.server, door.token);
    const live = liveCodes(list);
    const ordered = [...live, ...list.codes.filter((c) => c.revokedAt !== null)];
    const ring = shareKeyRing(crypt, session.code);
    let shown;
    try {
        shown = checkedDisplays(ring, ordered);
    }
    finally {
        ring.wipe();
    }
    const def = defaultCode(list)?.index ?? null;
    const activity = options.activity === true
        ? await codeActivity(crypt, session.code, { ...door, accountId: session.accountId }, list)
        : null;
    if (options.json === true) {
        const codes = ordered.map((r) => ({
            index: r.index,
            code: shown.get(r.index) ?? "",
            raw: r.address,
            default: r.index === def,
            createdAt: r.createdAt,
            revokedAt: r.revokedAt,
            sent: r.sent,
            received: r.received,
            messages: r.support,
            ...(activity === null ? {} : { activity: activity.get(r.index) ?? { sent: [], received: [] } }),
        }));
        say(JSON.stringify({ codes, live: live.length, liveMax: list.liveMax, madeToday: list.madeToday, dayCap: list.dayCap }));
        return 0;
    }
    if (ordered.length === 0) {
        say(`This account has no published public code yet.`);
        say(``);
        say(`  ${BINARY_NAME} public-code --publish`);
        return 0;
    }
    for (const r of ordered) {
        say(rowLine(r, shown.get(r.index) ?? "", r.index === def));
        if (activity !== null)
            for (const line of activityLines(activity.get(r.index)))
                say(line);
    }
    say(``);
    say(`${live.length} of ${list.liveMax} live · ${list.madeToday} of ${list.dayCap} made today (UTC)`);
    return 0;
}
/**
 * The revoke question, put to a person — or, with nobody to put it to, the refusal that carries it.
 * True when the answer is yes.
 */
async function confirmRevoke(index, display, options, say) {
    if (options.yes === true)
        return true;
    const question = `Revoke public code #${index} (${display})? Nobody can send to it again, and nobody can bring it ` +
        `back. Files already received with it stay.`;
    if (options.readLine === undefined && !stdinIsATerminal()) {
        throw new NmtsError(question, {
            exitCode: 5,
            nextStep: "This needs the person's yes. If they say yes, run the same command with --yes. Nothing was done.",
        });
    }
    const answer = (await (options.readLine ?? promptLine)(`${question} [y/N] `)).trim();
    if (answer === "y" || answer === "Y")
        return true;
    say(`Nothing was revoked.`);
    return false;
}
/** `nmts public-code new [--replace <n>]` — the next number, published; with --replace, that code revoked in the same request. */
export async function newCode(options = {}) {
    const say = sayer(options);
    const replace = options.replace === undefined ? undefined : codeNumber(options.replace, "--replace");
    const session = await openSession({ server: options.server, network: options.network });
    const crypt = await loadCrypto();
    const door = { server: session.server, token: session.apiKey };
    const list = await readPublicCodes(door.server, door.token);
    let replaced = null;
    if (replace !== undefined) {
        const row = liveCodes(list).find((c) => c.index === replace);
        if (row === undefined)
            throw notLiveCode(replace);
        replaced = checkedDisplay(crypt, session.code, row);
        if (!(await confirmRevoke(replace, replaced, options, say)))
            return 1;
    }
    let made;
    try {
        made = await publishCode(crypt, session.code, door, nextCodeIndex(list), replace);
    }
    catch (error) {
        throw publicCodeRefusal(error, { liveMax: list.liveMax, dayCap: list.dayCap, replace: defaultCode(list)?.index });
    }
    if (options.json === true) {
        say(JSON.stringify({ index: made.index, code: made.code, raw: made.address, revoked: replace ?? null }));
        return 0;
    }
    say(`made public code #${made.index}  ${made.code}`);
    if (replace !== undefined)
        say(`revoked #${replace}  ${replaced ?? ""}`);
    return 0;
}
/** `nmts public-code revoke <n>` — one way, and never the last live code. */
export async function revokeCodeCommand(operand, options = {}) {
    const say = sayer(options);
    const index = codeNumber(operand, "`public-code revoke`");
    const session = await openSession({ server: options.server, network: options.network });
    const crypt = await loadCrypto();
    const door = { server: session.server, token: session.apiKey };
    const list = await readPublicCodes(door.server, door.token);
    const row = list.codes.find((c) => c.index === index);
    if (row === undefined) {
        throw new NmtsError(`This account has no public code #${index}.`, {
            exitCode: 4,
            nextStep: `\`${BINARY_NAME} public-code list\` shows its codes.`,
        });
    }
    const display = checkedDisplay(crypt, session.code, row);
    if (row.revokedAt === null) {
        if (liveCodes(list).length <= 1)
            throw lastLiveCode(index);
        if (!(await confirmRevoke(index, display, options, say)))
            return 1;
        try {
            await revokeCode(door, index);
        }
        catch (error) {
            throw publicCodeRefusal(error, { replace: index });
        }
    }
    if (options.json === true) {
        say(JSON.stringify({ index, code: display, raw: row.address, revoked: true }));
        return 0;
    }
    say(row.revokedAt === null ? `revoked public code #${index}  ${display}` : `public code #${index} was already revoked on ${day(row.revokedAt)}`);
    return 0;
}
