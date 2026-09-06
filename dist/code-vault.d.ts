import { NmtsError } from "./errors.ts";
/** What gets written. Every field is needed to open it again; none of them is a secret. */
export interface LockedCode {
    /** Format version of THIS file, not of the NMTS crypto format. */
    v: 1;
    kdf: "scrypt";
    n: number;
    r: number;
    p: number;
    /** base64 */
    salt: string;
    /** base64 */
    nonce: string;
    /** base64, ciphertext followed by the 16-byte tag. */
    ct: string;
}
/** Thrown when the passphrase does not open the file. ⛔ Never says how close it was. */
export declare class WrongPassphraseError extends NmtsError {
    constructor();
}
/** Seal the code under a passphrase. The result is safe to write to a file. */
export declare function lockCode(code: string, passphrase: string): LockedCode;
/**
 * Open a sealed code.
 *
 * ⛔ The tag is checked before a single byte is returned — that is what `final()` does for GCM, and
 *    it is why a wrong passphrase cannot yield a plausible-looking wrong code.
 */
export declare function unlockCode(locked: LockedCode, passphrase: string): string;
/** Shape check for something read off disk. ⛔ A parser, not an assertion: the file is input. */
export declare function isLockedCode(value: unknown): value is LockedCode;
/**
 * Are these two passphrases the same? Used only to catch a typo when one is being set.
 *
 * ⚠ Constant-time because it costs nothing to be. Neither value is secret to this process, but a
 *   comparison that short-circuits is a habit worth not having near a passphrase.
 */
export declare function samePassphrase(a: string, b: string): boolean;
