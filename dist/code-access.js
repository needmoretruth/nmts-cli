// Getting the account code this run should actually use — including opening a sealed one.
//
// ⛔ WHY IT IS NOT IN `credentials.ts`. That module answers "where is the code"; this one answers
//    "may this run have it, and can it be opened". Putting the second question in the first module
//    would make `credentials.ts` import `consent.ts`, which already imports `credentials.ts` for
//    the config directory — a cycle that works until the day it does not.
//
// ⚠ EVERY COMMAND THAT USES THE CODE GOES THROUGH `openAccountCode` — with ONE exception, and it
//   is written here rather than left to be discovered. `login` does not: it is the command that
//   RECEIVES a code rather than one that uses a stored one, so it reads the ways in for itself
//   (`commands/login.ts`, `readTheCode`). It asks for the same `plain-env` agreement at that
//   point, because an adversarial review found that it did not, and two commands were then enough
//   to launder a code from the environment into a store that asks for nothing.
//
// ⛔ THAT EXCEPTION IS THE WHOLE RISK OF THIS SHAPE. A rule enforced at each call site has as many
//   holes as there are call sites, and the hole is always the newest one.
import { requireConsent } from "./consent.js";
import { unlockCode } from "./code-vault.js";
import { CODE_ENV_VAR, PASSPHRASE_ENV_VAR, credentialsPath, resolveAccountCode, } from "./credentials.js";
import { NmtsError, NotLoggedInError } from "./errors.js";
import { promptSecret, stdinIsATerminal } from "./prompt.js";
import { BINARY_NAME } from "./product.js";
export async function openAccountCode(options = {}) {
    const found = resolveAccountCode();
    if (found === null)
        return null;
    if (found.source === "env") {
        // ⛔ The one credential path that asks first. See the `plain-env` entry in consent.ts — the
        //    variable is readable in ways a file is not, and the person gets to decide that once.
        requireConsent("plain-env");
        return { code: found.code, source: "env" };
    }
    if (found.source !== "file-locked")
        return { code: found.code, source: found.source };
    const passphrase = await readPassphrase(options.allowPrompt !== false);
    return { code: unlockCode(found.locked, passphrase), source: "file-locked" };
}
/**
 * Where the passphrase comes from: the environment first, then a terminal.
 *
 * ⛔ THE ENVIRONMENT WINS so that an unattended agent works at all. It is a weaker arrangement and
 *    `consent.ts` says why; refusing it would not make anybody safer, it would make them write a
 *    wrapper that types the passphrase in, which is worse and invisible.
 */
async function readPassphrase(allowPrompt) {
    const fromEnv = process.env[PASSPHRASE_ENV_VAR];
    if (fromEnv !== undefined && fromEnv.length > 0)
        return fromEnv;
    if (!allowPrompt || !stdinIsATerminal()) {
        throw new NmtsError(`The stored account code is sealed with a passphrase.`, {
            exitCode: 3,
            nextStep: [
                allowPrompt
                    ? `There is no terminal to type it into, so one of these has to supply it:`
                    : `This command reads its own protocol from the terminal, so it cannot ask. Supply it:`,
                `  · set ${PASSPHRASE_ENV_VAR} for this run`,
                `  · name a file holding the code instead: NMTS_ACCOUNT_CODE_FILE=/path`,
                `  · store it unsealed: ${BINARY_NAME} login --plain  (this asks for an agreement first)`,
                ``,
                `The sealed file is ${credentialsPath()}.`,
            ].join("\n"),
        });
    }
    return promptSecret(`Passphrase for the stored account code: `, PASSPHRASE_ENV_VAR);
}
/**
 * The code, or a refusal naming what to do about it. For commands that cannot proceed without it.
 *
 * ⛔ The message never mentions the code itself, only where one could come from.
 */
export async function requireAccountCode(options = {}) {
    const opened = await openAccountCode(options);
    if (opened === null)
        throw new NotLoggedInError(BINARY_NAME, CODE_ENV_VAR);
    return opened;
}
