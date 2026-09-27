import { NmtsError } from "./errors.ts";
/** What the texts below fill in. Each is optional; a missing one falls back to a sentence without it. */
export interface RefusalFacts {
    /** How many live codes the account may hold. */
    liveMax?: number | undefined;
    /** How many new codes it may make per UTC day. */
    dayCap?: number | undefined;
    /** The number of the code a replacement would revoke — the account's default. */
    replace?: number | undefined;
}
/** The refusal a person reads for `error`, or `error` itself when it is not one of the table's. */
export declare function publicCodeRefusal(error: unknown, facts?: RefusalFacts): unknown;
/** Revoking `index` would leave the account with no live code. */
export declare function lastLiveCode(index: number | undefined): NmtsError;
/** A number that is not one of this account's live codes. */
export declare function notLiveCode(index: number): NmtsError;
/**
 * The server holds a code this key does not derive at that number.
 *
 * ⛔ THE BIGGER FACT, NOT "THE WRITE FAILED". Codes come from the NMTS key, so a different one means
 *    this machine holds a different account's key than the credential beside it.
 */
export declare function differentCode(): NmtsError;
/** A public code's number as a person typed it after `flag`. */
export declare function codeNumber(text: string | undefined, flag: string): number;
