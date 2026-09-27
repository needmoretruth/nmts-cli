import type { CryptoGlue } from "./crypto.ts";
import { type PublicCodeList } from "./public-codes.ts";
import type { ShareKeys, ShareSealed } from "./share.ts";
/** How many numbers after 0 opening tries when it cannot read the account's list. */
export declare const OFFLINE_WALK = 64;
/**
 * The number a handover is sent from: `--as`, or the lowest-numbered live code. An account that has
 * never published sends from code 0, the code its key has always had.
 */
export declare function senderIndexOf(list: PublicCodeList, as: string | undefined): number;
/** The keys at `index`, refused by name when the server lists another code at that number. */
export declare function checkedKeys(crypt: CryptoGlue, code: string, list: PublicCodeList, index: number): ShareKeys;
/** Whether `address` is one of this account's codes — live, revoked, or the one it is sending from. */
export declare function isMine(list: PublicCodeList, keys: ShareKeys, address: Uint8Array): boolean;
/** What opening found: the file key, the code it opened with, and — when known — whether that code is revoked. */
export interface OpenedWith {
    dek: Uint8Array;
    index: number;
    display: string;
    address: Uint8Array;
    /** From the account's list when it was read; null when it was not. */
    revoked: boolean | null;
}
/** Open a handover envelope with whichever of this account's codes it was sealed to. */
export declare function openWithMyCodes(crypt: CryptoGlue, code: string, sealed: ShareSealed, server: string): Promise<OpenedWith>;
