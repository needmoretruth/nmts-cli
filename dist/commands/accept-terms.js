// `nmts accept-terms` — a PERSON accepts the documents in force, from the terminal.
//
// ⛔ WHY IT EXISTS (2026-09-06). When a new version of the Terms takes effect the server
//    refuses this account's uploads and shares until the new version is accepted (Terms 15.5). An
//    account driven from a terminal holds an API key and the account code and never a session,
//    and a key is not allowed to accept — a key accepting would be a program consenting on
//    somebody's behalf. Until this command the only way out was a browser. Now the same record is
//    written from here, proved the way a browser sign-in is proved: by the account code.
//
// ⛔ IT IS A PERSON'S ACT, AND THREE THINGS KEEP IT ONE. It is refused in mode auto and under
//    --skip-permissions before the code is even opened. It needs a terminal to type into — there is
//    no `--terms <v>` flag, because a flag is what an agent would pass. And the two versions are
//    TYPED, not confirmed with a key press: typing the version string is what the browser's screen
//    asks for too, and it is the smallest act that cannot be done without having looked.
//
// ⛔ TWO ANSWERS, NOT ONE, for the same reason the browser has two controls. Consent to the Terms is
//    a contract; the Privacy Policy is not consented to — its own §7.3 rests the processing on
//    contract and legitimate interests — so the second line acknowledges READING it. The call to the
//    server is the same pair the screen sends.
//
// ⛔ WHAT LEAVES THIS MACHINE is the account id, the sign-in proof (`account-proof.ts` says what
//    that is and why it decrypts nothing) and the two typed versions. The account code does not.
import { accountProofFor } from "../account-proof.js";
import { identityOf } from "../account.js";
import { request } from "../api.js";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile, resolveApiKey } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { promptLine, stdinIsATerminal } from "../prompt.js";
import { resolveServer } from "../server.js";
export async function acceptTerms(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // The tier gate has already refused or asked by mode. The two versions are typed here by a
    // person at a terminal, or — when an agent relays the person's acceptance — named on the
    // command line: `--accept-terms <version> --accept-privacy <version>`.
    const relayed = options.terms !== undefined && options.privacy !== undefined;
    const ask = options.readLine ?? promptLine;
    if (!relayed && options.readLine === undefined && !stdinIsATerminal()) {
        throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
            exitCode: 3,
            nextStep: `Run this where a person can type the two versions, or — after they have said so — ` +
                `\`${BINARY_NAME} accept-terms --accept-terms <version> --accept-privacy <version> --yes\`.`,
        });
    }
    const held = await requireAccountCode();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    // The key is only for READING where the account stands; the acceptance itself needs none — an
    // account whose key cannot even be minted until it accepts (`key new` is refused too) still has
    // this way in.
    const key = resolveApiKey();
    const standing = key === null ? null : await standingOf(server, key.key);
    if (standing !== null && !standing.owed) {
        say(`This account has already accepted the documents in force ` +
            `(Terms of Service ${standing.terms} · Privacy Policy ${standing.privacy}). Nothing to do.`);
        return 0;
    }
    if (standing === null) {
        say(`No API key on this machine, so where this account stands could not be read.`);
        say(`Each document prints its version at the top.`);
    }
    else {
        say(`In force: Terms of Service ${standing.terms} · Privacy Policy ${standing.privacy}.`);
        say(`This account has not accepted this pair, so uploads and shares are refused until it does.`);
    }
    say(`Read them first: \`${BINARY_NAME} terms\` · \`${BINARY_NAME} privacy\` · what changed: ` +
        `\`${BINARY_NAME} notices\` (or ${HOME_URL}/notices).`);
    say(``);
    const terms = (options.terms ?? (await ask(`Type the Terms of Service version you have read and accept: `))).trim();
    const privacy = (options.privacy ?? (await ask(`Type the Privacy Policy version you have read: `))).trim();
    if (terms === "" || privacy === "") {
        say(`Nothing was accepted.`);
        return 1;
    }
    const identity = await identityOf(held.code);
    // ⛔ THE PROOF IS BUILT FOR THIS ONE REQUEST AND NOTHING KEEPS IT. `accountProofFor` also asks
    //    for the agreement that covers sending it when the code came from an environment variable.
    const authSecret = await accountProofFor({ code: held.code, source: held.source });
    await request(server, "/v1/account/accept-terms/by-code", {
        method: "POST",
        body: {
            account_id: identity.accountId,
            auth_secret: authSecret,
            terms_version: terms,
            privacy_version: privacy,
        },
    });
    say(`Recorded: this account accepts the Terms of Service ${terms} and has read the Privacy Policy ${privacy}.`);
    say(`Uploads and shares are open again.`);
    return 0;
}
async function standingOf(server, apiKey) {
    const answer = await request(server, "/v1/account/summary", { token: apiKey });
    const terms = isRecord(answer) ? answer["terms"] : undefined;
    if (!isRecord(terms))
        throw new NmtsError("The server described the account in a shape this version cannot read.");
    const required = terms["required_terms_version"];
    const privacy = terms["required_privacy_version"];
    // No pair in force means the gate is off and nothing is owed — the same reading `balance` makes.
    if (typeof required !== "string" || typeof privacy !== "string") {
        return { owed: false, terms: "none", privacy: "none" };
    }
    return { owed: terms["acceptance_required"] === true, terms: required, privacy };
}
