// `nmts create` without a key: the code is made here, and a PERSON finishes the account in a
// browser.
//
// ⛔ WHY THIS PATH EXISTS. The other one needs an API key whose account had a person pass the
//    human check — which is fine once somebody has an account, and impossible for the first one.
//    So the tool makes the NMTS key on this machine, buys a one-time address with a proof of
//    work, and prints it. A person opens that address, types the code this printed, passes the
//    check, and the account is made at that moment. Nothing here can do it for them, and that is
//    the point rather than a limitation.
//
// ⛔ THE CODE NEVER GOES TO THE SERVER, NOT EVEN HASHED. What is sent is the account id — a public
//    identifier derived one-way from the code — and nothing else. The pair that proves ownership
//    is derived IN THE BROWSER from what the person types there.
//
// ⛔ THE FILE IS WRITTEN BEFORE THE ADDRESS IS ASKED FOR, the same rule the key path keeps: a full
//    disk must fail while there is nothing to lose. ⚠ Unlike that path, a refusal afterwards does
//    NOT remove the file — nothing has been created yet, so the code is not "the key to an account
//    that may exist"; it is simply a code nobody has registered, and running again makes another.
//    Removing it would be deleting a file a person may already have copied somewhere.
//
// ⛔ NOTHING IS STORED ON THIS MACHINE. `nmts login` is what puts a code here, and it is a separate
//    act on purpose — see the header of `create.ts`.
import { createHash } from "node:crypto";
import { request } from "../api.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { newAccountCode, registrationProofOf } from "../registration.js";
import { codeFileTarget, jsonNeedsAFile, writeCodeFile } from "./create-code-file.js";
/** How often the status of a link is asked about, in milliseconds. */
const POLL_EVERY_MS = 3_000;
/** How long this waits before giving up on a person, in milliseconds. Matches the link's own life. */
const WAIT_FOR_MS = 30 * 60 * 1000;
/** Say "this is working" only if the work actually takes a moment. */
const QUIET_FOR_MS = 1_000;
/** Hashes between clock reads while solving. Small enough to notice a second; large enough to cost nothing. */
const CHECK_EVERY = 4_096;
export async function createThroughLink(options) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const { server, network } = options;
    // ⛔ EVERY REFUSAL THAT DOES NOT NEED THE NETWORK HAPPENS FIRST.
    const codeFile = codeFileTarget(options.out);
    if (options.json === true && codeFile === null)
        throw jsonNeedsAFile();
    const puzzle = await askForWork(server);
    const code = await newAccountCode();
    const proof = await registrationProofOf(code);
    if (codeFile !== null)
        writeCodeFile(codeFile, code);
    const nonce = solve(puzzle.challenge, proof.accountId, puzzle.bits, say);
    const answer = await request(server, "/v1/accounts/registration-links", {
        method: "POST",
        body: { account_id: proof.accountId, challenge: puzzle.challenge, nonce },
    });
    const url = stringField(answer, "url");
    const expiresAt = stringField(answer, "expires_at");
    if (url === null)
        throw unexpected("an address");
    const linkId = url.slice(url.lastIndexOf("/") + 1);
    const statusUrl = `${server}/v1/accounts/registration-links/${linkId}`;
    if (options.json === true && codeFile !== null) {
        // ⛔ NO `account_code` FIELD, AND THERE NEVER WILL BE — see `create.ts`. ⚠ And no waiting:
        //    machine-readable output is one object, and the address is worth nothing to the program
        //    reading it until it has handed it to a person. `status_url` is how it finds out what
        //    happened next.
        say(JSON.stringify({ url, expires_at: expiresAt, code_file: codeFile, status_url: statusUrl }));
        return 0;
    }
    sayTheAddress(say, url, expiresAt, server, network);
    await sayTheQr(say, url);
    if (options.noWait === true) {
        say(``);
        say(`Not waiting. To find out whether it was used:`);
        say(``);
        say(`  ${statusUrl}`);
        say(``);
        say(`It answers {"status":"pending"}, {"status":"done"} or {"status":"expired"}.`);
        sayWhereTheCodeIs(say, codeFile, code);
        return 0;
    }
    say(``);
    say(`Waiting. This stops on its own when the address runs out.`);
    const finished = await waitForAPerson(server, linkId);
    if (!finished)
        throw nobodyCame(statusUrl);
    say(``);
    say(`Registered. The account exists now.`);
    sayWhereTheCodeIs(say, codeFile, code);
    sayWhatIsNext(say);
    return 0;
}
async function askForWork(server) {
    const answer = await request(server, "/v1/accounts/registration-challenge");
    const challenge = stringField(answer, "challenge");
    const bits = isRecord(answer) ? answer["difficulty_bits"] : null;
    if (challenge === null || typeof bits !== "number" || !Number.isFinite(bits) || bits < 0) {
        throw unexpected("a challenge");
    }
    return { challenge, bits };
}
/**
 * Find a nonce whose digest under this challenge starts with `bits` zero bits.
 *
 * ⛔ THE RULE IS `SHA-256(challenge ‖ account_id ‖ nonce)` OVER THE THREE STRINGS' UTF-8 BYTES, IN
 *    THAT ORDER, WITH NOTHING BETWEEN THEM. The server computes the same digest and refuses
 *    anything else, so this sentence is the contract between the two — a separator nobody wrote
 *    down is how two implementations of one rule stop agreeing. The account id is in it so that
 *    one piece of work buys an address for one id and nothing else.
 *
 * ⚠ IT BLOCKS. At the difficulty this service sets it is about a million digests and well under a
 *   couple of seconds; there is nothing else for this command to be doing meanwhile, and a
 *   progress bar over a number nobody can act on is noise. One line, and only if it is slow.
 */
function solve(challenge, accountId, bits, say) {
    const started = Date.now();
    let said = false;
    for (let n = 0;; n += 1) {
        const nonce = String(n);
        const digest = createHash("sha256").update(challenge).update(accountId).update(nonce).digest();
        if (leadingZeroBits(digest) >= bits) {
            return nonce;
        }
        if (n % CHECK_EVERY === 0 && !said && Date.now() - started > QUIET_FOR_MS) {
            say(`Preparing…`);
            said = true;
        }
    }
}
function leadingZeroBits(digest) {
    let seen = 0;
    for (const byte of digest) {
        seen += Math.clz32(byte) - 24;
        if (byte !== 0)
            break;
    }
    return seen;
}
/**
 * Ask the server, every few seconds, whether somebody has used the address.
 *
 * ⚠ `expired` ENDS THE WAIT. The link's life and this deadline are the same thirty minutes, so a
 *   server that says "expired" is telling us the person did not come — waiting past that would be
 *   waiting for something that can no longer happen.
 */
async function waitForAPerson(server, linkId) {
    const deadline = Date.now() + WAIT_FOR_MS;
    for (;;) {
        const answer = await request(server, `/v1/accounts/registration-links/${linkId}`);
        const status = stringField(answer, "status");
        if (status === "done")
            return true;
        if (status === "expired")
            return false;
        if (Date.now() >= deadline)
            return false;
        await new Promise((done) => setTimeout(done, POLL_EVERY_MS));
    }
}
function sayTheAddress(say, url, expiresAt, server, network) {
    say(`A person has to finish this in a browser. Nothing on this machine can.`);
    say(``);
    say(`  ${url}`);
    say(``);
    say(expiresAt === null
        ? `Opening it asks for the NMTS key below, and for the check that says a person is here.`
        : `It works until ${expiresAt}. Opening it asks for the NMTS key below, and for the ` +
            `check that says a person is here.`);
    say(`The account will exist on ${server} (${network}) the moment they finish.`);
}
/**
 * The address again, as something a phone can read.
 *
 * ⚠ The same settings the browser's own codes use (`wallet address --qr`): medium error correction
 *   and a two-module quiet zone, without which many scanners see nothing at all.
 */
async function sayTheQr(say, url) {
    const { renderUnicodeCompact } = await import("uqr");
    say(``);
    for (const row of renderUnicodeCompact(url, { ecc: "M", border: 2 }).split("\n"))
        say(`  ${row}`);
}
/**
 * The code, last, with the one thing that has to be understood before it.
 *
 * ⛔ NOTHING FOLLOWS IT BUT WHAT TO DO WITH IT. A screen of next steps under an NMTS key is how
 *    a person scrolls past the only copy of it.
 */
function sayWhereTheCodeIs(say, codeFile, code) {
    say(``);
    say(`⛔ THIS IS THE ONLY COPY OF THE NMTS KEY THAT WILL EVER EXIST.`);
    say(`   NMTS keeps a verifier and never the NMTS key. It cannot be reset, resent or replaced.`);
    say(`   Lose it and the account and every file in it are gone — for you and for NMTS.`);
    say(``);
    say(`   ${codeFile ?? code}`);
    say(``);
    say(codeFile === null
        ? `It is what the browser asks for, and what \`${BINARY_NAME} login\` stores on a machine.`
        : `That file holds it, readable by you alone. It is what the browser asks for.`);
}
/**
 * The key is what makes the server answer this tool, and since 2026-09-05 the NMTS key this
 * machine already holds is enough to make one — no browser, no person at the account screen.
 */
function sayWhatIsNext(say) {
    say(``);
    say(`Next: \`${BINARY_NAME} key new\` makes this machine's API key out of that NMTS key and stores it.`);
    say(`Nothing else is needed before the first \`${BINARY_NAME} put\`.`);
}
function nobodyCame(statusUrl) {
    return new NmtsError(`The address ran out before anybody used it.`, {
        // ⛔ 5 — "waiting on the person". Nothing went wrong and nothing is malformed; what is missing
        //    is an act only a person can perform.
        exitCode: 5,
        nextStep: [
            `No account was created, and the NMTS key that was made for it is now good for nothing.`,
            `Running \`${BINARY_NAME} create\` again makes a NEW NMTS key and a NEW address; it does not`,
            `resume this one.`,
            ``,
            `If somebody is finishing it right now, this says so: ${statusUrl}`,
        ].join("\n"),
    });
}
function unexpected(what) {
    return new NmtsError(`The server did not answer with ${what}.`, {
        exitCode: 1,
        nextStep: `Nothing was created. This tool may be older than the server it is talking to.`,
    });
}
function stringField(answer, field) {
    const value = isRecord(answer) ? answer[field] : null;
    return typeof value === "string" && value.length > 0 ? value : null;
}
