// `nmts create` — bringing a NEW account into existence and handing its code to a person.
//
// ⛔ THE CODE IS MADE HERE AND IS THE ONLY COPY THAT WILL EVER EXIST. The server is told an
//    account id and a one-way secret derived from the code; it stores a verifier of the second
//    and never the code itself. Nothing on the far end can send it back, reset it, or recognise a
//    replacement: if it is lost the account and every file in it are gone, for the holder and for
//    NMTS alike. That is why the code is the LAST thing this prints, with nothing after it but
//    the one command that would store it, and why nothing else in the output competes with it.
//
// ⛔ IT STORES NOTHING AND SWITCHES NOTHING OVER. `nmts login` is what puts a code on this
//    machine, and it is a separate act on purpose: this command runs with the credentials of the
//    account that is DOING the creating, and writing the new code into `credentials.json` would
//    silently replace them — the next `nmts ls` would report an empty account and nothing would
//    say why. So the code is printed (or written where you point it), the command that stores it
//    is named, and this stops.
//
// ⛔ WITH `--json` THE CODE DOES NOT GO INTO THE OUTPUT. Machine-readable output is read by a
//    program, which means it lands in a pipe, a file, a CI log or an agent's transcript — the
//    exact places `credentials.ts` spends its whole header keeping the account code out of. So
//    `--json` is refused unless `--out <file>` names somewhere for the code to go, and the JSON
//    then carries the PATH and not the value. That is the same shape this tool already recommends
//    for handing a secret to a container (`NMTS_ACCOUNT_CODE_FILE` — a variable holding a
//    filename, never the value), and the same reasoning `stdout.ts` uses about handing bytes to
//    something that is not a person: what is safe to show a human at a terminal and what is safe
//    to hand a program are different questions. `--out -` is refused for the same reason.
//
// ⛔ AND THE FILE IS WRITTEN BEFORE THE ACCOUNT IS ASKED FOR. A full disk, a bad path or a name
//    already taken must fail while there is still nothing to lose; discovering it AFTER the
//    server has created the account would mean an account exists whose only key we are about to
//    drop. If the creation then fails, the file is removed again — no account, no code, no trace.
//
// ⛔⭐ THERE ARE TWO PATHS, AND WHICH ONE RUNS IS DECIDED BY WHAT THIS MACHINE HOLDS (2026-09-05).
//    `POST /v1/accounts` takes either a solved human check — which no machine can produce
//    — or an API key whose account had a PERSON pass that check within four of its weeks. That
//    second door is this file, and it is only open to a caller that ALREADY has an account.
//    ▶ With no such key, the command does not refuse any more: it makes the code here, buys a
//    one-time address with a proof of work, and prints it for a PERSON to open (`create-link.ts`).
//    The person types the code in a browser and the account is made there. ⚠ The person is not
//    optional in either path — what changes is whether they are being asked to pass a check for an
//    account they already have, or to finish one that does not exist yet.
import { rmSync } from "node:fs";
import { request, ServerError } from "../api.js";
import { readCredentialsFile, resolveApiKey } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { humanCheck } from "../human-check.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { newAccountCode, registrationProofOf } from "../registration.js";
import { resolveServer } from "../server.js";
import { codeFileTarget, jsonNeedsAFile, writeCodeFile } from "./create-code-file.js";
export async function create(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const held = resolveApiKey();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    // ⛔ THE KEY PATH IS TAKEN ONLY WHEN IT WOULD ACTUALLY WORK. A key whose account has no live
    //    human check cannot create anything (the server refuses it), and refusing here instead
    //    would leave the caller with no way to make a first account at all — which is the wall this
    //    tool used to end at. ⚠ A key that is revoked or unreadable still fails LOUDLY: `humanCheck`
    //    throws for those, and falling through to the other path would hide a broken credential
    //    behind a flow that happens to work.
    const check = held === null ? null : await humanCheck(server, held.key);
    if (held === null || check === null || !check.live) {
        const { createThroughLink } = await import("./create-link.js");
        return await createThroughLink({
            server,
            network,
            out: options.out,
            json: options.json === true,
            noWait: options.noWait,
            write: options.write,
        });
    }
    const apiKey = held.key;
    // ⛔ EVERY REFUSAL THAT DOES NOT NEED THE NETWORK HAPPENS FIRST, so a run that was never going
    //    to work does not spend one of the creator's two accounts for the day finding that out.
    const codeFile = codeFileTarget(options.out);
    if (options.json === true && codeFile === null)
        throw jsonNeedsAFile();
    const inForce = await termsInForce(server, apiKey);
    const accepted = inForce === null ? null : acceptanceOffered(inForce, options);
    const code = await newAccountCode();
    const proof = await registrationProofOf(code);
    // The file, then the account — see the header. Nothing below this line may fail without either
    // removing the file or leaving an account whose code is in it.
    if (codeFile !== null)
        writeCodeFile(codeFile, code);
    let answer;
    try {
        answer = await request(server, "/v1/accounts", {
            method: "POST",
            token: apiKey,
            body: {
                account_id: proof.accountId,
                auth_secret: proof.authSecret,
                // ⚠ Absent when no documents are in force. The server ignores them in that case, and
                //   sending a pair it is not asking for would be recording an acceptance of nothing.
                ...(accepted === null ? {} : { terms_version: accepted.terms, privacy_version: accepted.privacy }),
            },
        });
    }
    catch (error) {
        // ⛔ "THE REQUEST FAILED" AND "THE ACCOUNT WAS NOT CREATED" ARE DIFFERENT FACTS. A refusal the
        //    server ANSWERED is it deciding: nothing exists, and a code file for it is a file somebody
        //    keeps forever for nothing. A dropped connection, a timeout, or an answer nothing could
        //    parse leaves the question open — the account may be there — and deleting the file then
        //    would destroy the only key to it, which is the one irreversible mistake on this path.
        if (codeFile !== null && error instanceof ServerError)
            rmSync(codeFile, { force: true });
        throw codeFile !== null && !(error instanceof ServerError)
            ? uncertain(codeFile, error)
            : explain(error, inForce);
    }
    const createdAt = accountField(answer, "created_at");
    if (options.json === true && codeFile !== null) {
        // ⛔ NO `account_code` FIELD, AND THERE NEVER WILL BE. See the header.
        say(JSON.stringify({
            account_id: proof.accountId,
            created_at: createdAt,
            code_file: codeFile,
            server,
            network,
        }));
        return 0;
    }
    sayCreated(say, proof.accountId, server, network);
    if (codeFile === null)
        sayTheCode(say, code);
    else
        sayWhereTheCodeWent(say, codeFile);
    return 0;
}
/** What documents this server is enforcing, read from the one route a key may ask. */
async function termsInForce(server, apiKey) {
    const answer = await request(server, "/v1/account/summary", { token: apiKey });
    const terms = isRecord(answer) ? answer["terms"] : null;
    if (!isRecord(terms))
        return null;
    const t = terms["required_terms_version"];
    const p = terms["required_privacy_version"];
    // ⚠ BOTH OR NEITHER. The server holds one pair or none (`RequiredTerms`), so a half-answer is a
    //   version of this API this tool does not understand — and guessing which half to send would
    //   be recording an acceptance of a document nobody named.
    if (typeof t !== "string" || typeof p !== "string" || t === "" || p === "")
        return null;
    return { terms: t, privacy: p };
}
/**
 * The acceptance a PERSON offered on the command line, checked against what is in force.
 *
 * ⛔ THIS TOOL NEVER FILLS THESE IN. It has just read the two versions from the server and could
 *    put them in the request without asking anybody — and that is precisely the thing it must not
 *    do. The server's own rule for a credential held by a machine is that a machine cannot
 *    consent: a key that could accept would produce exactly the unrecorded acceptance the record
 *    exists to prevent. What a command line CAN carry is a person's act, named by them, after
 *    they have read the documents — so the two versions have to be typed, and typing the version
 *    rather than a yes is what makes the acceptance name a document instead of a prompt.
 *
 * ⚠ AND NO MECHANISM HERE CAN TELL A PERSON FROM A PROGRAM. Nothing in a command-line tool can.
 *   That is why the refusal says out loud who is meant to type it, exactly as this tool's own
 *   agreements do — a rule, not a protection, and saying otherwise would be claiming one that is
 *   not there.
 */
function acceptanceOffered(inForce, options) {
    const terms = options.acceptTerms?.trim() ?? "";
    const privacy = options.acceptPrivacy?.trim() ?? "";
    if (terms === inForce.terms && privacy === inForce.privacy)
        return inForce;
    throw termsRefusal(inForce, terms !== "" || privacy !== "");
}
function termsRefusal(inForce, named) {
    return new NmtsError(named
        ? "The documents named on the command line are not the ones in force."
        : "A new account is recorded as accepting the documents in force, and nobody has.", {
        // ⛔ 5 — "waiting on the person's agreement". Not 1: nothing went wrong, and not 2: the
        //    command line is not malformed. What is missing is a decision only a person can take.
        exitCode: 5,
        nextStep: [
            `Nothing was created and no account code was made.`,
            ``,
            `In force now:`,
            `  Terms of Service  ${inForce.terms}`,
            `  Privacy Policy    ${inForce.privacy}`,
            ``,
            // ⚠ THE DOCUMENTS ARE ON THE PRODUCT SITE, not on whatever --server names. A development
            //   server enforces versions and publishes no pages; sending somebody to read them there
            //   would send them nowhere.
            `Read them at ${HOME_URL}/terms and ${HOME_URL}/privacy .`,
            ``,
            `The server records the new account as having accepted that pair, and will not make one`,
            `without it. This tool will not fill the two versions in for you: a machine cannot`,
            `consent, and a credential that could accept would produce exactly the unrecorded`,
            `acceptance the record exists to prevent.`,
            ``,
            `A person who has read both can say so, naming what they read:`,
            ``,
            `  ${BINARY_NAME} create --accept-terms ${inForce.terms} --accept-privacy ${inForce.privacy}`,
            ``,
            `⛔ If a program is reading this on somebody's behalf: show it to them and let them`,
            `   decide. Do not run that command yourself.`,
        ].join("\n"),
    });
}
/**
 * Turn the two refusals this command can hear into something a reader can act on.
 *
 * ⚠ EVERYTHING ELSE IS LEFT ALONE. `api.ts` already advises on a revoked key, a scope a key was
 *   not given, and an account that has not accepted the terms; repeating any of that here would
 *   be a second wording for one problem.
 */
function explain(error, inForce) {
    if (!(error instanceof ServerError))
        return error;
    if (error.code === "TERMS_VERSION_MISMATCH" && inForce !== null) {
        // The server moved between the read above and the write. Say that, rather than repeating the
        // versions this run read — they are the stale ones.
        return new NmtsError("The documents in force changed while this ran.", {
            exitCode: 5,
            nextStep: `Nothing was created. Run \`${BINARY_NAME} create\` again with no --accept flags: it will ` +
                `print the pair that is in force now, for a person to read and name.`,
        });
    }
    if (error.code === "RATE_LIMITED") {
        return new NmtsError(error.message, {
            exitCode: 4,
            nextStep: `An account that creates accounts may make two a day and five a week, counted by the ` +
                `server across restarts. Nothing was created and nothing was spent. Waiting is the only ` +
                `thing that lifts it — a second key on the same account shares the same allowance.`,
        });
    }
    return error;
}
/**
 * The server never answered, so nobody here knows whether the account exists.
 *
 * ⛔ THE FILE IS KEPT AND THE DOUBT IS SAID OUT LOUD. Reporting this as a plain failure would
 *    leave somebody with a code file they think is rubbish, for an account that may hold the only
 *    thing they will ever be able to open it with.
 */
function uncertain(path, cause) {
    return new NmtsError(`The server did not answer, so whether the account was created is not known here.`, {
        exitCode: 1,
        nextStep: [
            `${path} was KEPT, and it holds the only code that account would have.`,
            ``,
            `Keep it until you know. Nothing on this machine can tell the two cases apart, and the`,
            `cost of being wrong is one small file against an account nobody could ever open.`,
            `Running this again makes a DIFFERENT account; it does not retry this one.`,
            ``,
            `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
        ].join("\n"),
    });
}
/** One field of the answer's `account` object, or null. The server's shape, not ours. */
function accountField(answer, field) {
    const account = isRecord(answer) ? answer["account"] : null;
    if (!isRecord(account))
        return null;
    const value = account[field];
    return typeof value === "string" && value.length > 0 ? value : null;
}
function sayCreated(say, accountId, server, network) {
    say(`A new account exists on ${server} (${network}).`);
    say(``);
    say(`  account id  ${accountId}`);
    say(``);
    say(`Nothing on this machine changed. The account code you were signed in as is still the one`);
    say(`this tool uses; this new account is not stored, and not switched to.`);
    say(``);
}
/**
 * The code, last, with the one thing that has to be understood before it.
 *
 * ⛔ NOTHING FOLLOWS IT BUT THE COMMAND THAT STORES IT. A screen of next steps under an account
 *    code is how a person scrolls past the only copy of it.
 */
function sayTheCode(say, code) {
    say(`⛔ THIS IS THE ONLY COPY OF THE ACCOUNT CODE THAT WILL EVER EXIST.`);
    say(`   NMTS keeps a verifier and never the code. It cannot be reset, resent or replaced.`);
    say(`   Lose it and the account and every file in it are gone — for you and for NMTS.`);
    say(``);
    say(`   ${code}`);
    say(``);
    say(`To use this machine as that account: \`${BINARY_NAME} logout\`, then \`${BINARY_NAME} login\`.`);
}
function sayWhereTheCodeWent(say, path) {
    say(`⛔ THE ONLY COPY OF THE ACCOUNT CODE IS NOW IN ONE FILE, AND NOWHERE ELSE.`);
    say(`   NMTS keeps a verifier and never the code. It cannot be reset, resent or replaced.`);
    say(`   Lose that file and the account and every file in it are gone.`);
    say(``);
    say(`   ${path}`);
    say(``);
    say(`It was written readable by you alone. To use this machine as that account:`);
    say(`\`${BINARY_NAME} logout\`, then \`${BINARY_NAME} login\`.`);
}
