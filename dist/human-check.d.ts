import { NmtsError } from "./errors.ts";
/** Where this account stands with the periodic check a person passes. */
export interface HumanCheck {
    live: boolean;
    /** The moment the current window ends, as the server spelled it, or null. */
    until: string | null;
}
/**
 * Ask the server whether a person's check is live for the account this key belongs to.
 *
 * ⛔ THE ADDRESS IS WRITTEN OUT AT THE CALL rather than held in a constant, for the reason
 *    `commands/verify.ts` gives: the gate that checks this tool's addresses against the server's
 *    own routes reads the literal in the call, and a constant would make it stop looking here.
 */
export declare function humanCheck(server: string, apiKey: string): Promise<HumanCheck>;
/**
 * The one refusal for "a person has to do something first".
 *
 * ⛔ IT NAMES THE COMMAND AND SAYS WHO HAS TO RUN IT. `verify` prints a short code and waits; the
 *    typing is a person's, at a browser, and no amount of retrying here replaces it. Saying only
 *    "refused" would send an agent round the loop of credentials it already has.
 */
export declare function askAPersonToVerify(whatIsRefused: string): NmtsError;
