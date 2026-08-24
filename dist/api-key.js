// The API key: what the string is, how one gets onto this machine, and what is checked first.
//
// ⛔ WHY THIS FILE EXISTS. Until it did, `login` could only copy forward a key that was ALREADY in
//    the credentials file — there was no way to hand the tool one. The ways a key could arrive
//    were an environment variable read afresh on every command, and a person opening
//    ~/.nmts/credentials.json in a text editor. The second is how a credential ends up in a shell
//    history, a backup, or a repository, and the first is not storage at all: close the terminal
//    and the tool is back to knowing nothing. That is the step a first-time user stops at.
//
// ⛔ NEVER FROM THE COMMAND LINE, for the reason written at the top of `credentials.ts`: on Linux
//    any process can read another's /proc/<pid>/cmdline for as long as it lives, and the shell
//    writes it to a history file. So there is no --api-key flag here and there never should be.
//    The ways in are the three the account code already has — a file an environment variable
//    NAMES, the variable itself, and a prompt that echoes nothing.
//
// ⛔ THE SHAPE IS JUDGED HERE, BEFORE ANYTHING LEAVES THIS MACHINE, and that is not tidiness. The
//    likeliest wrong thing to paste where a key is asked for is the ACCOUNT CODE, and sending it
//    as a bearer token would put the one secret this product promises never travels onto the wire,
//    into whatever sits in front of the server, and into its logs. The server does classify it and
//    refuse (`ACCOUNT_CODE_NOT_A_CREDENTIAL`) rather than store it — but that answer arrives after
//    the code has already been sent. So the refusal happens offline, and a test asserts that the
//    server was asked nothing at all.
//
// ⚠ THE SHAPE IS A SECOND COPY OF THE SERVER'S OWN — same prefix, same lengths, same fixed
//   offsets as the parser that will judge the key at the other end. A second copy can drift; what
//   stops the drift being silent is that the prefix carries a FORMAT VERSION. A server that starts
//   issuing another shape issues `nmts_ak2_…`, which this refuses by name rather than
//   half-accepting.
//
// ⛔ AND NO FIFTH CONSENT KEY. `consent.ts` allows four and says why: the bar is that the thing
//    cannot be undone, costs money, or puts the ACCOUNT CODE somewhere that is not this tool's
//    sealed file. A key is none of the three — it opens no ciphertext, the account screen revokes
//    it, it expires by itself, and every command in this tool already reads it out of the
//    environment without asking. A fifth question here is a fifth chance to teach somebody to
//    click through the four that matter.
import { request, ServerError } from "./api.js";
import { API_KEY_ENV_VAR, API_KEY_FILE_ENV_VAR, readSecretFile } from "./credentials.js";
import { loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { HOME_URL } from "./product.js";
import { promptSecret, stdinIsATerminal } from "./prompt.js";
/** The fixed, greppable prefix. `ak1` is the format version. ⚠ Must match what the server issues. */
export const KEY_PREFIX = "nmts_ak1_";
/** base64url over 9 random bytes. PUBLIC — this is the handle the account screen lists. */
export const KEY_HANDLE_LEN = 12;
/** base64url over 32 random bytes. The secret half, and the reason nothing here prints a key. */
const KEY_SECRET_LEN = 43;
/** One line, exactly this long: 9 + 12 + 1 + 43. */
export const KEY_LEN = KEY_PREFIX.length + KEY_HANDLE_LEN + 1 + KEY_SECRET_LEN;
/** Where the `_` between the two halves stands. ⛔ Fixed, for the reason in `wellFormed`. */
const SEPARATOR_AT = KEY_PREFIX.length + KEY_HANDLE_LEN;
const B64URL = /^[A-Za-z0-9_-]+$/u;
/** The word that replaces a key already on this machine. Compared lower-cased and trimmed. */
const REPLACE_WORD = "replace";
/**
 * Decide what a string is, without touching the network.
 *
 * ⛔ PARSED BY FIXED OFFSETS, NEVER BY SPLITTING ON `_`. The base64url alphabet contains `_`, so
 *    splitting cuts the string in a place that depends on its random bytes: the same code would
 *    accept one key and mangle the next. The Rust side says the same thing in the same words.
 */
export function wellFormed(value) {
    if (!value.startsWith(KEY_PREFIX))
        return { kind: "not-a-key" };
    if (value.length !== KEY_LEN)
        return { kind: "malformed" };
    if (value[SEPARATOR_AT] !== "_")
        return { kind: "malformed" };
    const handle = value.slice(KEY_PREFIX.length, SEPARATOR_AT);
    const secret = value.slice(SEPARATOR_AT + 1);
    if (!B64URL.test(handle) || !B64URL.test(secret))
        return { kind: "malformed" };
    return { kind: "key", handle };
}
/** The key to write down, or nothing. */
export function keyToStore(outcome) {
    return outcome.kind === "none" ? undefined : outcome.apiKey;
}
/** The name of the place a key was offered from, for a message that has to say which one. */
export function keySourceName(from) {
    switch (from) {
        case "secret-file":
            return API_KEY_FILE_ENV_VAR;
        case "env":
            return API_KEY_ENV_VAR;
        case "terminal":
            // ⚠ Unreachable today: the prompt below happens only when nothing is stored, and the one
            //   message that names a source is the one about NOT replacing something. Written out
            //   anyway, because a switch that returns undefined for a case is how that stops being true.
            return "what was typed";
    }
}
/**
 * Work out which key this machine should end up with, checking any new one before it is written.
 *
 * ⛔ A KEY ALREADY HERE IS NEVER REPLACED BY A RUN THAT DID NOT SAY SO. `login` is a command about
 *    the account code; a person re-sealing their code with a new passphrase, on a machine where an
 *    old variable is still set in some shell profile, has not asked for their working key to be
 *    swapped for whatever that variable holds. Silently overwriting it would break every agent on
 *    the machine at a moment nobody would connect to the command they ran.
 */
export async function settleApiKey(intake) {
    const offered = await offer(intake);
    const stored = intake.stored;
    if (offered === null) {
        return stored === undefined ? { kind: "none" } : { kind: "unchanged", apiKey: stored };
    }
    if (stored !== undefined) {
        // ⚠ The same key offered again is not a replacement, and it is not re-checked either: nothing
        //   about it changed, and a question with one answer is a question worth not asking.
        if (offered.value === stored)
            return { kind: "unchanged", apiKey: stored };
        if (!(await agreedToReplace(intake)))
            return { kind: "kept", apiKey: stored, from: offered.from };
    }
    const shape = wellFormed(offered.value);
    if (shape.kind !== "key")
        throw await refuse(shape, offered.value);
    const verified = await checkedByTheServer(intake.server, offered.value);
    return { kind: "stored", apiKey: offered.value, handle: shape.handle, verified, from: offered.from };
}
/**
 * Where a key is looked for, in order.
 *
 * ⚠ A FILE FIRST, because that is the shape this tool recommends and the only one a container
 *   cannot leak: `docker inspect` prints a container's whole environment, and a variable holding a
 *   PATH gives that reader a filename. Then the variable, then a person.
 *
 * ⛔ THE PROMPT ONLY HAPPENS WHEN THERE IS NOTHING STORED. Asking somebody who already has a
 *   working key whether they would like to type another one, every time they run `login`, is how a
 *   prompt gets answered without being read.
 */
async function offer(intake) {
    const fromFile = readSecretFile(API_KEY_FILE_ENV_VAR);
    if (fromFile !== null)
        return { value: fromFile, from: "secret-file" };
    const fromEnv = process.env[API_KEY_ENV_VAR]?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0)
        return { value: fromEnv, from: "env" };
    if (intake.stored !== undefined)
        return null;
    const ask = intake.readKey ?? terminalAsk(`API key, or Enter to skip (not shown as you type): `);
    if (ask === null)
        return null;
    // ⚠ Trimmed, like every other secret this tool reads. Whitespace cannot be part of a key — the
    //   alphabet is base64url — and refusing a pasted key for a trailing newline would be a puzzle
    //   with no clue in it.
    const typed = (await ask()).trim();
    return typed.length === 0 ? null : { value: typed, from: "terminal" };
}
/**
 * The deliberate act that replaces a stored key.
 *
 * ⚠ IT IS ASKED WITHOUT ECHO, WHICH IS UNUSUAL FOR A YES/NO — and the prompt says so. The terminal
 *   is held in raw mode across the whole of `login` (see `prompt.ts`), where nothing echoes unless
 *   something writes the characters back; a second reader that did would be a second place for the
 *   next secret prompt to leak through. One word typed blind is the smaller cost.
 *
 * ⛔ NO TERMINAL MEANS NO. The other way through is `logout`, which is a thing somebody has to run
 *    on purpose — exactly what "deliberate" has to mean where nobody can be asked.
 */
async function agreedToReplace(intake) {
    const ask = intake.confirmReplace ??
        terminalAsk(`A key is already stored. Type "${REPLACE_WORD}" to replace it (not shown as you type): `);
    if (ask === null)
        return false;
    return (await ask()).trim().toLowerCase() === REPLACE_WORD;
}
/** A question for the terminal, or null when there is no terminal to ask at. */
function terminalAsk(question) {
    if (!stdinIsATerminal())
        return null;
    return () => promptSecret(question, API_KEY_ENV_VAR);
}
/**
 * Refusals that mean the KEY is the problem, rather than the moment.
 *
 * ⛔ THE DIFFERENCE IS WHAT THE READER DOES NEXT. A revoked key will never work and the answer is
 *    to make another one; a rate limit or a server fault is the same key a minute later. Wearing
 *    one message for both would send an agent to make a new key every time the server hiccupped.
 */
const KEY_IS_THE_PROBLEM = new Set([
    "UNAUTHORIZED",
    "API_KEY_MALFORMED",
    "API_KEY_REVOKED",
    "API_KEY_EXPIRED",
    "ACCOUNT_CODE_NOT_A_CREDENTIAL",
    "ACCOUNT_BANNED",
]);
/**
 * Ask the server whether this is a key it will answer, and hand back what it said about the person.
 *
 * ⛔ WHY CHECK AT ALL. A wrong key that is merely written down comes back as a refusal on some
 *    later command — where it cannot be told apart from an expired key, a suspended account, a
 *    missing scope or a server that is down, and where the person has stopped thinking about the
 *    thing they pasted. Checked here, a wrong key is wrong at the moment it is typed.
 *
 * ⛔ AND THIS IS THE ONLY DOOR A KEY REACHES WITHOUT HOLDING A PERMISSION. The server's written
 *    table of what a key may address marks `GET /v1/agent/verify` reachable by ANY live key: it
 *    touches no file, spends no credit, and asks for no scope. Every other route a key may address
 *    demands one, so checking against any of them would refuse a key that is perfectly good and
 *    merely narrow — a read-only key would be called broken by the one command whose job is to say
 *    whether it works.
 *
 * ⚠ WHAT IT PROVES IS "THE SERVER ANSWERS THIS KEY", NOT "THE KEY CAN DO WHAT YOU WANT". Scopes
 *   are decided when the key is made and a scope refusal arrives, named, at the command that needs
 *   it (`API_KEY_SCOPE` in api.ts).
 */
async function checkedByTheServer(server, key) {
    let answer;
    try {
        answer = await request(server, "/v1/agent/verify", { token: key });
    }
    catch (error) {
        throw notWritten(error);
    }
    if (typeof answer === "object" && answer !== null) {
        const verified = Reflect.get(answer, "verified");
        if (typeof verified === "boolean")
            return verified;
    }
    // ⛔ A 200 IS NOT ENOUGH ON ITS OWN. Something in front of an NMTS server — a proxy, a captive
    //    portal, a stub — can answer 200 with JSON to anything, and storing a key on that evidence
    //    would be calling "the address is wrong" "the key works".
    throw new NmtsError(`${server} answered, but not the way an NMTS server does.`, {
        exitCode: 1,
        nextStep: `The answer did not say whether this account's human check is live, which that address ` +
            `always says. Nothing was written to this machine. Check --server.`,
    });
}
/** ⛔ One sentence, one place: every refusal on this path has to say that nothing was kept. */
const NOTHING_WAS_WRITTEN = `Nothing was written to this machine: a key is checked before it is stored.`;
function notWritten(error) {
    if (error instanceof ServerError) {
        const itsTheKey = KEY_IS_THE_PROBLEM.has(error.code);
        return new NmtsError(itsTheKey ? `The server did not accept that key.` : error.message, {
            // ⚠ 3 is "not signed in", which is what a rejected credential is; anything else is the
            //   server's own exit code, because the key may be fine and the moment wrong.
            exitCode: itsTheKey ? 3 : error.exitCode,
            nextStep: joinSteps(itsTheKey ? error.message : null, error.nextStep, NOTHING_WAS_WRITTEN),
        });
    }
    if (error instanceof NmtsError) {
        // A timeout, an unreachable host, a wrong scheme. Its own words are right; only the last line
        // is missing, and it is the one a person is about to wonder about.
        return new NmtsError(error.message, {
            exitCode: error.exitCode,
            nextStep: joinSteps(error.nextStep, NOTHING_WAS_WRITTEN),
        });
    }
    return error;
}
function joinSteps(...parts) {
    return parts.filter((part) => part !== null && part.length > 0).join("\n\n");
}
/**
 * The refusal for something that is not a key, worded for the mistake that was actually made.
 *
 * ⛔ IT NAMES NO VALUE — not the string, not a fragment of it, not the handle of a thing that
 *    turned out not to be a key. The length is named, exactly as the server's own parser does,
 *    because "sixty-four arrived" is the sentence that finds a truncated paste.
 */
async function refuse(shape, value) {
    if (shape.kind === "malformed") {
        return new NmtsError(`That is not a whole NMTS API key.`, {
            exitCode: 2,
            nextStep: `A key is ONE line of ${KEY_LEN} characters beginning \`${KEY_PREFIX}\`; ${value.length} ` +
                `arrived. Check that the whole string was copied, with no quotes around it and no line ` +
                `break in the middle. ${NOTHING_WAS_WRITTEN}`,
        });
    }
    if (await looksLikeAnAccountCode(value)) {
        return new NmtsError(`That is an account code, not an API key.`, {
            exitCode: 2,
            nextStep: `It was NOT sent anywhere: the account code stays on this machine, and it is what opens ` +
                `your files. An API key is a different thing — it makes the server answer a program, and ` +
                `it opens nothing. Make one on the account screen at ${HOME_URL}; it begins ` +
                `\`${KEY_PREFIX}\`. ${NOTHING_WAS_WRITTEN}`,
        });
    }
    return new NmtsError(`That is not an NMTS API key.`, {
        exitCode: 2,
        nextStep: `A key is one line of ${KEY_LEN} characters beginning \`${KEY_PREFIX}\`, made on the ` +
            `account screen at ${HOME_URL}. ${NOTHING_WAS_WRITTEN}`,
    });
}
/**
 * Is this the account code, pasted where the key goes?
 *
 * ⛔ ASKED OF THE ENGINE'S OWN PARSER, which verifies the code's trailing check symbol. Copying the
 *    alphabet here would be a second implementation of a format this repo keeps in exactly one
 *    place, and it would answer "yes" to any string of the right letters.
 *
 * ⚠ "Could not tell" counts as NOT a code. All this decides is which of two refusals is printed —
 *   both of them refuse — so an engine that will not load must not turn a refusal into a crash.
 */
async function looksLikeAnAccountCode(value) {
    try {
        const glue = await loadCrypto();
        const bytes = glue.account_code_parse(value);
        // ⛔ Wiped like every other derivation in this tool: these twenty bytes ARE the account, and
        //    they were produced only to answer a yes/no question.
        bytes.fill(0);
        return true;
    }
    catch {
        // ⛔ The engine's own message is never repeated: it can contain the input.
        return false;
    }
}
