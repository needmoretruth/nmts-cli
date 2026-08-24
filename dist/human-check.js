// Has a person been behind this account lately, and the one sentence to say when they have not.
//
// ⛔ WHY THIS IS ASKED BEFORE THE REQUEST IT GUARDS, RATHER THAN LEARNED FROM ITS REFUSAL. The
//    server decides scope FIRST and the person's check second (`api/src/auth/api_key_auth.rs`),
//    on purpose: *"a key that does not hold the bit learns nothing about whether the account
//    behind it is verified"*. That is right for the server and it means the refusal a caller
//    hears can be `API_KEY_SCOPE` while the thing that is actually missing is a person. An agent
//    reading "the key was not given permission for this" goes and makes another key, which cannot
//    help, instead of asking somebody to spend thirty seconds at a browser.
//
// ⛔ SO THIS IS A MESSAGE, NOT A DEFENCE. Nothing here decides anything: the server refuses or
//    does not, whatever this says. What it buys is that the caller is told the one thing it can
//    act on, in the one wording, before it has been sent looking at its credentials.
//
// ⚠ AND IT COSTS ONE READ. `GET /v1/agent/verify` is reachable by ANY key, holds no scope
//   requirement, and answers a single boolean — it is the cheapest question in this API and the
//   only one that can be asked before knowing whether the key is allowed to do anything at all.
import { request } from "./api.js";
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
import { BINARY_NAME } from "./product.js";
/**
 * Ask the server whether a person's check is live for the account this key belongs to.
 *
 * ⛔ THE ADDRESS IS WRITTEN OUT AT THE CALL rather than held in a constant, for the reason
 *    `commands/verify.ts` gives: the gate that checks this tool's addresses against the server's
 *    own routes reads the literal in the call, and a constant would make it stop looking here.
 */
export async function humanCheck(server, apiKey) {
    const answer = await request(server, "/v1/agent/verify", { token: apiKey });
    if (!isRecord(answer) || typeof answer["verified"] !== "boolean") {
        throw new NmtsError("The server's answer did not say whether this account is verified.", {
            exitCode: 1,
            nextStep: `This version of \`${BINARY_NAME}\` and that server do not agree about this. Update the tool, or check --server.`,
        });
    }
    const until = answer["verified_until"];
    return { live: answer["verified"], until: typeof until === "string" ? until : null };
}
/**
 * The one refusal for "a person has to do something first".
 *
 * ⛔ IT NAMES THE COMMAND AND SAYS WHO HAS TO RUN IT. `verify` prints a short code and waits; the
 *    typing is a person's, at a browser, and no amount of retrying here replaces it. Saying only
 *    "refused" would send an agent round the loop of credentials it already has.
 */
export function askAPersonToVerify(whatIsRefused) {
    return new NmtsError(`${whatIsRefused} until somebody passes this account's human check.`, {
        exitCode: 4,
        nextStep: `Run \`${BINARY_NAME} verify\`. It prints a short code and an address; a person opens that ` +
            `address, types the code, and this account's limits are lifted for four of the server's ` +
            `weeks. Nothing on this machine can pass that check — being unable to is what it measures.`,
    });
}
