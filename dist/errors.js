// How this tool fails.
//
// ⛔ AN AGENT READS THESE. Every message here is written for a reader that will act on it without
//    asking a person: it says what happened, and it says the one thing to do next. "Unauthorized"
//    tells an agent nothing it can use; "your API key was revoked — issue a new one at
//    nmts.me/account" tells it whether to retry, ask, or stop.
//
// ⛔ NOTHING SECRET IS EVER INTERPOLATED. Not the account code, not the API key, not a session
//    token. An error string is the one place a secret escapes without anybody choosing to print
//    it, and agents copy error strings into logs and prompts by default.
//
// ⛔⭐ THAT RULE COVERS WHAT THIS TOOL WRITES — AND `renderError` PRINTS WHAT IT DID NOT. An
//    unknown error's `message` goes out verbatim, which is right (a swallowed cause is a debug
//    session nobody can start) and is also a hole: an adversarial review made `JSON.parse` fail on
//    the credentials file, and V8's own message quotes about thirty characters of the input —
//    nine symbols of a real account code reached stderr. The fix is not here. It is that anything
//    reading a file the code is in must catch its own parser and throw a message of its own
//    (`credentials.ts`, `unusable`). ▶ Any NEW code that parses a secret-bearing file owes the
//    same, and this paragraph is the reason why.
/** A failure this tool understood, with an exit code and something the caller can do. */
export class NmtsError extends Error {
    exitCode;
    /** One line naming the next action, or null when there is nothing useful to suggest. */
    nextStep;
    constructor(message, options = {}) {
        super(message);
        this.name = "NmtsError";
        this.exitCode = options.exitCode ?? 1;
        this.nextStep = options.nextStep ?? null;
    }
}
/** Nothing is signed in on this machine and no code was supplied. */
export class NotLoggedInError extends NmtsError {
    constructor(binary, envVar) {
        super(`No NMTS account code on this machine.`, {
            exitCode: 3,
            nextStep: `Run \`${binary} login\`, or set ${envVar} in the environment.`,
        });
        this.name = "NotLoggedInError";
    }
}
/** The command exists but is not built yet. Said plainly rather than failing as if it broke. */
export class NotBuiltYetError extends NmtsError {
    constructor(what) {
        super(`${what} is not built yet.`, {
            exitCode: 4,
            nextStep: `This is not a failure — the command is announced but unfinished. Do not retry.`,
        });
        this.name = "NotBuiltYetError";
    }
}
/** Render a failure for a terminal an agent is reading. */
export function renderError(error, binary) {
    if (error instanceof NmtsError) {
        const lines = [`${binary}: ${error.message}`];
        // ⛔ EVERY line of the next step is indented, not just the first. A multi-line explanation
        //    whose second line runs flush to the margin reads as a separate message, and the one
        //    place that matters is a warning somebody is deciding on.
        if (error.nextStep) {
            for (const line of error.nextStep.split("\n"))
                lines.push(line === "" ? "" : `  ${line}`);
        }
        return lines.join("\n");
    }
    // Unknown failures print their message and nothing else — no stack, which is where paths,
    // usernames and sometimes arguments leak into whatever the agent logs.
    const message = error instanceof Error ? error.message : String(error);
    return `${binary}: ${message}`;
}
/** Exit code for an unknown failure, kept distinct from the ones above. */
export const UNKNOWN_FAILURE_EXIT = 1;
