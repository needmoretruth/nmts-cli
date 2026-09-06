/** The fixed, greppable prefix. `ak1` is the format version. ⚠ Must match what the server issues. */
export declare const KEY_PREFIX = "nmts_ak1_";
/** base64url over 9 random bytes. PUBLIC — this is the handle the account screen lists. */
export declare const KEY_HANDLE_LEN = 12;
/** One line, exactly this long: 9 + 12 + 1 + 43. */
export declare const KEY_LEN: number;
/**
 * What a string turns out to be.
 *
 * ⛔ NO VARIANT CARRIES THE VALUE. A shape that held the offending string would be a credential in
 *    every error message built from it, which is the hole `errors.ts` spends a paragraph on.
 */
export type KeyShape = {
    readonly kind: "key";
    readonly handle: string;
} | {
    readonly kind: "malformed";
} | {
    readonly kind: "not-a-key";
};
/**
 * Decide what a string is, without touching the network.
 *
 * ⛔ PARSED BY FIXED OFFSETS, NEVER BY SPLITTING ON `_`. The base64url alphabet contains `_`, so
 *    splitting cuts the string in a place that depends on its random bytes: the same code would
 *    accept one key and mangle the next. The Rust side says the same thing in the same words.
 */
export declare function wellFormed(value: string): KeyShape;
/** Where an offered key came from. Reported, never guessed. */
export type KeyOffer = "secret-file" | "env" | "terminal";
/**
 * What `login` decided about the API key.
 *
 * ⛔ FOUR CASES AND NOT A NULLABLE STRING. "No key at all" and "the key that was already here" are
 *    different things to a person setting this tool up for the first time: one of them means every
 *    command that talks to the server is about to refuse, and that is the sentence they need. A
 *    single `string | undefined` would compile everywhere and say nothing.
 */
export type KeyOutcome = {
    readonly kind: "none";
} | {
    readonly kind: "unchanged";
    readonly apiKey: string;
} | {
    readonly kind: "stored";
    readonly apiKey: string;
    readonly handle: string;
    /** Whether a person's periodic check is live for this account right now. */
    readonly verified: boolean;
    readonly from: KeyOffer;
} | {
    readonly kind: "kept";
    readonly apiKey: string;
    readonly from: KeyOffer;
};
export interface KeyIntake {
    /** The server the key will be checked against, and the one it belongs to. */
    server: string;
    /** What is already stored on this machine, if anything. */
    stored: string | undefined;
    /** Injected in tests so the terminal is not involved. An empty answer means "not now". */
    readKey?: (() => Promise<string>) | undefined;
    /** Injected in tests. Answers the question that replaces a stored key. */
    confirmReplace?: (() => Promise<string>) | undefined;
}
/** The key to write down, or nothing. */
export declare function keyToStore(outcome: KeyOutcome): string | undefined;
/** The name of the place a key was offered from, for a message that has to say which one. */
export declare function keySourceName(from: KeyOffer): string;
/**
 * Work out which key this machine should end up with, checking any new one before it is written.
 *
 * ⛔ A KEY ALREADY HERE IS NEVER REPLACED BY A RUN THAT DID NOT SAY SO. `login` is a command about
 *    the NMTS key; a person re-sealing their code with a new passphrase, on a machine where an
 *    old variable is still set in some shell profile, has not asked for their working key to be
 *    swapped for whatever that variable holds. Silently overwriting it would break every agent on
 *    the machine at a moment nobody would connect to the command they ran.
 */
export declare function settleApiKey(intake: KeyIntake): Promise<KeyOutcome>;
