// What a person is told when a public-code door refuses — one table, read by `nmts public-code …`
// and by `nmts share`.
//
// ⛔ IT TRANSLATES ONLY WHAT IT KNOWS. A refusal whose code is not in this table is handed on as
//    the server sent it (`ServerError`, with the server's own advice), not reworded into a guess.
//
// ⚠ THE NUMBERS COME FROM THE REFUSAL WHEN IT CARRIES THEM (`details.cap`) and from the account's
//   list otherwise — the server's ceiling, not a copy of it kept here.
import { ServerError } from "./api.js";
import { NmtsError } from "./errors.js";
import { BINARY_NAME } from "./product.js";
function capOf(error, fallback) {
    const cap = error.details["cap"];
    return typeof cap === "number" ? cap : fallback;
}
/** The refusal a person reads for `error`, or `error` itself when it is not one of the table's. */
export function publicCodeRefusal(error, facts = {}) {
    if (!(error instanceof ServerError))
        return error;
    switch (error.code) {
        case "TOO_MANY_LIVE_CODES": {
            const cap = capOf(error, facts.liveMax);
            const said = cap === undefined ? "as many live public codes as you may" : `${cap} live public codes`;
            return new NmtsError(`You already hold ${said}.`, {
                exitCode: 4,
                nextStep: "Revoke one first, or make the new one with --replace <number>.",
            });
        }
        case "PUBLIC_CODE_DAY_CAP": {
            const cap = capOf(error, facts.dayCap);
            const said = cap === undefined ? "as many public codes today as you may" : `${cap} public codes today`;
            return new NmtsError(`You have made ${said}.`, { exitCode: 4, nextStep: "Try again after 00:00 UTC." });
        }
        case "LAST_LIVE_CODE":
            return lastLiveCode(facts.replace);
        case "PLATFORM_REPLACE_ONLY":
            return new NmtsError("This account holds one public code, so a new one replaces it.", {
                exitCode: 4,
                nextStep: `Use --replace ${facts.replace ?? "<number>"}.`,
            });
        case "PUBLIC_CODE_REVOKED":
            return new NmtsError("Its owner has revoked that public code.", {
                exitCode: 4,
                nextStep: "Ask them for the code they use now.",
            });
        default:
            return error;
    }
}
/** Revoking `index` would leave the account with no live code. */
export function lastLiveCode(index) {
    return new NmtsError("That is your last live public code.", {
        exitCode: 4,
        nextStep: `Make a new one first: ${BINARY_NAME} public-code new --replace ${index ?? "<number>"}`,
    });
}
/** A number that is not one of this account's live codes. */
export function notLiveCode(index) {
    return new NmtsError(`Public code #${index} is not a live code of this account.`, {
        exitCode: 4,
        nextStep: `\`${BINARY_NAME} public-code list\` shows which are.`,
    });
}
/**
 * The server holds a code this key does not derive at that number.
 *
 * ⛔ THE BIGGER FACT, NOT "THE WRITE FAILED". Codes come from the NMTS key, so a different one means
 *    this machine holds a different account's key than the credential beside it.
 */
export function differentCode() {
    return new NmtsError("This account already publishes a different public code.", {
        exitCode: 4,
        nextStep: "The public code is derived from the NMTS key, so a different one means this machine " +
            "is holding a different account's code than the key beside it. Check which account you meant.",
    });
}
/** A public code's number as a person typed it after `flag`. */
export function codeNumber(text, flag) {
    const trimmed = (text ?? "").trim();
    const n = /^[0-9]{1,10}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!Number.isSafeInteger(n) || n > 2 ** 31 - 2) {
        throw new NmtsError(`${flag} takes a public code's number, as \`${BINARY_NAME} public-code list\` prints it.`, {
            exitCode: 2,
        });
    }
    return n;
}
