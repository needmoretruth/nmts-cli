import { type CryptoGlue } from "./crypto.ts";
import { type ShareKeys, type ShareSealed } from "./share.ts";
/** The largest number a code may carry — the server keeps it in a signed 32-bit column. */
export declare const CODE_INDEX_MAX: number;
/** A code number as a caller wrote it. Refused, never rounded: a neighbouring code is a different one. */
export declare function requireCodeIndex(value: number): number;
/**
 * Everything sharing needs for public code number `index` — the same shape `shareKeysOf` answers,
 * which is exactly what it answers for 0. ⛔ The caller wipes it.
 */
export declare function shareKeysAt(crypt: CryptoGlue, code: string, index: number): ShareKeys;
/** The keys of several codes of one NMTS key. */
export interface ShareKeyRing {
    /** The keys at `index`, made on first use and kept. Not to be wiped by the caller. */
    at(index: number): ShareKeys;
    /** Wipes every key made and the root they grew from. */
    wipe(): void;
}
/**
 * The keys of several codes, from ONE run of the key's derivation, on first use. What stays between
 * uses is code 0's keys and the 32-byte root the other numbers grow from — never the rest of the
 * derivation. ⛔ `wipe()` wipes all of it.
 */
export declare function shareKeyRing(crypt: CryptoGlue, code: string): ShareKeyRing;
/**
 * Open one envelope with whichever of `indices` it was sealed to, trying them in the order given.
 *
 * ⛔ ONE REFUSAL FOR EVERY FAILURE. Which number was tried and how it failed is not something to
 *    report: a wrong code, a tampered envelope and a sender who is not who it claims all fail the
 *    same way, and saying which would be telling somebody holding the file more than the file says.
 */
export declare function openShareAnyCode(crypt: CryptoGlue, code: string, indices: readonly number[], sealed: ShareSealed): {
    dek: Uint8Array;
    index: number;
};
/** `openShareAnyCode` with a ring the caller holds, and wipes. */
export declare function openShareWithRing(crypt: CryptoGlue, ring: ShareKeyRing, indices: readonly number[], sealed: ShareSealed): {
    dek: Uint8Array;
    index: number;
};
