// `nmts public-code` — the value other accounts send files to, and publishing it so they can.
//
// ⛔ IT IS CALLED THE PUBLIC CODE HERE BECAUSE THAT IS WHAT THE PRODUCT CALLS IT. The browser's
//    screens say "public code", and this program used to say "address" for the same value — two
//    names for one thing, which is the mistake a locked wording decision exists to stop. It also
//    printed it in a different encoding than the browser shows, so somebody copying from one and
//    pasting into the other had two ways to be wrong about one value. Both are fixed here: one
//    name, and the same grouped form a person sees on the screen.
//
// ⛔ ONE KEY, SEVERAL CODES. An account holds one to three live public codes,
//    numbered from the one NMTS key; the bare command shows the DEFAULT — the lowest-numbered live
//    one — and `list · new · revoke` (`public-code-manage.ts`) handle the rest. A published code
//    never changes; what changes is which codes are live, and revoking one is one way.
//
// ⛔ WHY PUBLISHING IS A SEPARATE STEP AND NOT SOMETHING THIS COMMAND JUST DOES. Sending a file
//    already publishes the sender's code as a side effect, because a share cannot exist without
//    one and the person has already decided to hand something over. RECEIVING is the other way
//    round: nothing has been decided yet. So the plain command reads, says whether it can be sent
//    to, and names the flag; `--publish` is the deliberate act.
//
// ⛔ IT IS NOT A CHOICE. The code and the identity behind it are derived from the NMTS key, so the
//    same key produces the same bytes at the same number on any device, and the server refuses a
//    bundle whose claimed value is not the fingerprint of its own root.
//
// ⚠ IT IS NOT THE NMTS KEY. That one opens every file in the account and must never be given
//   to anybody; this one is meant to be given away, and on its own it opens nothing.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile, resolveApiKey } from "../credentials.js";
import { publicCodeFileText } from "../handover.js";
import { checkedKeys } from "../handover-codes.js";
import { publicCodeFileName } from "../shared/lib/share/handover-format.js";
import { loadCrypto } from "../crypto.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { codeNumber, publicCodeRefusal } from "../public-code-refusals.js";
import { defaultCode, liveCodes, nextCodeIndex, publishCode, readPublicCodes } from "../public-codes.js";
import { resolveServer } from "../server.js";
import { openSession } from "../session.js";
import { shareKeysAt } from "../share-codes.js";
import { checkedDisplay } from "./public-code-manage.js";
/** `nmts public-code [list|new|revoke]` and `nmts public-code --save [file]`, from the parsed command line. */
export async function runPublicCode(args) {
    const sub = args.operands[0] ?? "";
    const common = { server: args.server, network: args.network, json: args.json };
    // ⚠ WITH --save THE OPERAND IS THE FILE, not a verb — the same reading `risk.ts` gives it.
    if (sub === "" || args.save) {
        return await publicCode({ ...common, publish: args.publish, save: args.save, as: args.as, file: args.operands[0], force: args.force });
    }
    const manage = await import("./public-code-manage.js");
    switch (sub) {
        case "list":
            return await manage.listCodes({ ...common, activity: args.activity });
        case "new":
            return await manage.newCode({ ...common, replace: args.replace, yes: args.yes });
        case "revoke":
            return await manage.revokeCodeCommand(args.operands[1], { ...common, yes: args.yes });
        default:
            throw new NmtsError(`"${sub}" is not a public-code command.`, {
                exitCode: 2,
                nextStep: `\`${BINARY_NAME} public-code\`, \`public-code list\`, \`public-code new\` or \`public-code revoke <number>\`.`,
            });
    }
}
export async function publicCode(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (options.save === true) {
        if (options.publish === true) {
            throw new NmtsError("--save and --publish are two different things; run them one at a time.", { exitCode: 2 });
        }
        return await savePublicCodeFile(options, say);
    }
    const session = await openSession({ server: options.server, network: options.network });
    const crypt = await loadCrypto();
    const door = { server: session.server, token: session.apiKey };
    const list = await readPublicCodes(door.server, door.token);
    const held = defaultCode(list);
    let shown;
    let live = liveCodes(list).length;
    if (held !== null) {
        // ⛔ IF THE SERVER HOLDS A CODE THIS KEY DOES NOT MAKE AT THAT NUMBER, STOP (`differentCode`).
        shown = { index: held.index, code: checkedDisplay(crypt, session.code, held), raw: held.address };
    }
    else if (options.publish === true) {
        try {
            const made = await publishCode(crypt, session.code, door, nextCodeIndex(list));
            shown = { index: made.index, code: made.code, raw: made.address };
            live = 1;
        }
        catch (error) {
            throw publicCodeRefusal(error, { liveMax: list.liveMax, dayCap: list.dayCap });
        }
    }
    else {
        const keys = shareKeysAt(crypt, session.code, nextCodeIndex(list));
        shown = { index: keys.index, code: keys.display, raw: Buffer.from(keys.address).toString("base64url") };
        keys.wipe();
    }
    const published = live > 0;
    if (options.json === true) {
        // ⚠ BOTH FORMS. `code` is what a person reads and types; `raw` is what the wire carries.
        //   A reader that has only one of them ends up converting, and that is a second place to be wrong.
        say(JSON.stringify({ code: shown.code, raw: shown.raw, published, index: shown.index, live }));
        return 0;
    }
    if (published) {
        say(`public code  ${shown.code}   (default · ${live} of ${list.liveMax} live)`);
        say(``);
        say(`Give it to whoever is sending. ⛔ It is NOT your NMTS key — that one opens`);
        say(`every file you have and is never given to anybody. This one opens nothing.`);
        return 0;
    }
    say(`public code  ${shown.code}`);
    say(`             NOT published — nobody can send to it yet`);
    say(``);
    say(`Publishing writes it on the server so a sender can find the key to seal to.`);
    say(`A published code cannot be changed. You can revoke it and make a new one with`);
    say(`  ${BINARY_NAME} public-code new`);
    say(`The code comes from your NMTS key, so the same key always gives the same code.`);
    say(``);
    say(`  ${BINARY_NAME} public-code --publish`);
    return 0;
}
/**
 * `nmts public-code --save [file]` — this account's public code file (NCF-3 §5.7).
 *
 * ⛔ NOTHING IN IT IS SECRET: the identity is derived from the NMTS key on this machine, exactly the
 *    bytes `--publish` would put on the server. Whoever holds the file can seal a handover to this
 *    account without looking the code up — which is the point: that lookup is the one thing that
 *    tells NMTS who is sending to whom.
 *
 * ⚠ WHICH CODE: `--as <n>` names it and nothing is asked of the server. Without it, the default —
 *   read off the account's list when a key on this machine can read it, and code 0, the code every
 *   key starts with, when none can.
 */
async function savePublicCodeFile(options, say) {
    const { code } = await requireAccountCode();
    const crypt = await loadCrypto();
    const keys = await savedCodeKeys(crypt, code, options);
    const force = options.force === true;
    const file = options.file;
    const out = resolve(file === undefined || file === "" ? publicCodeFileName(keys.display) : file);
    try {
        writeFileSync(out, publicCodeFileText(keys), { flag: force ? "w" : "wx" });
    }
    catch {
        throw new NmtsError(`Could not write ${out}.`, {
            exitCode: 4,
            nextStep: "If it already exists, name another file or replace it with --force.",
        });
    }
    finally {
        keys.wipe();
    }
    if (options.json === true) {
        say(JSON.stringify({ code: keys.display, index: keys.index, out }));
        return 0;
    }
    say(`public code file  ${out}`);
    say(`                  for public code #${keys.index}  ${keys.display}`);
    say(``);
    say(`Whoever has this file can hand files over to you without asking NMTS.`);
    return 0;
}
/** The keys the file is written from: `--as`, else the default code, else code 0. */
async function savedCodeKeys(crypt, code, options) {
    if (options.as !== undefined)
        return shareKeysAt(crypt, code, codeNumber(options.as, "--as"));
    const key = resolveApiKey();
    if (key === null)
        return shareKeysAt(crypt, code, 0);
    let list;
    try {
        list = await readPublicCodes(resolveServer(options.server ?? readCredentialsFile()?.server), key.key);
    }
    catch {
        throw new NmtsError("Could not read which public code is your default.", {
            exitCode: 4,
            nextStep: "Nothing was written. Pass --as <number> to write the file for that code without asking the server.",
        });
    }
    return checkedKeys(crypt, code, list, defaultCode(list)?.index ?? 0);
}
