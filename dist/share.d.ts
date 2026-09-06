import { type CryptoGlue } from "./crypto.ts";
/**
 * This account's sharing secrets, and the identity other people encrypt to.
 *
 * ⛔ THE CALLER WIPES IT. Three of these are secrets sliced out of the account's derivation, and
 *    they open every share this account has ever received. `wipe()` on every path out, including
 *    failures.
 */
export interface ShareKeys {
    /** Key-agreement seed. */
    kemSeed: Uint8Array;
    /** Proves this account SENT a share. */
    authSecret: Uint8Array;
    /** Signs the published identity. */
    sigSeed: Uint8Array;
    /** This account's 16-byte public code, in its wire form. */
    address: Uint8Array;
    /** The published identity bundle other people encrypt to. */
    identity: Uint8Array;
    /** The address in the form a person reads and types. */
    display: string;
    wipe(): void;
}
/** Derive everything sharing needs from an NMTS key. */
export declare function shareKeysOf(crypt: CryptoGlue, code: string): ShareKeys;
/** The three sealed fields a share carries, base64url, exactly as they go to the server. */
export interface SharePayload {
    dek_share_ct: string;
    name_share_ct: string;
    content_hash_share_ct: string;
}
/**
 * Seal one file for one recipient.
 *
 * `recipientIdentity` is checked against `recipientAddress` inside the engine before anything is
 * encrypted to it — length, fingerprint, self-signature and key decoding — which is why both are
 * arguments and why there is no form of this that takes the identity alone. A tool that fetched an
 * identity and wrapped to it without naming the address it asked for would hand a readable key to
 * whoever answered.
 */
export declare function sealShare(crypt: CryptoGlue, input: {
    keys: ShareKeys;
    recipientIdentity: Uint8Array;
    recipientAddress: Uint8Array;
    /** The file's own key, already unwrapped from the account's sealed list. */
    dek: Uint8Array;
    /** The file's id, exactly as it will be posted. */
    itemId: string;
    /** The name the recipient sees, and the file's real plaintext length. */
    name: string;
    size: number;
    /** The file's whole-plaintext digest, opened from the account's own sealed copy. */
    digest: Uint8Array;
}): SharePayload;
/** One row of what somebody shared with this account, as the server describes it. */
export interface ReceivedRow {
    id: string;
    item_id: string;
    /** Bytes on the storage network — NOT the file's length. The sealed document has that. */
    size: number;
    sender_public_key?: string;
    dek_share_ct: string;
    name_share_ct: string;
    content_hash_share_ct: string;
    created_at: string;
}
/** What a received share turns into once opened, or why it could not be. */
export interface OpenedShare {
    id: string;
    itemId: string;
    createdAt: string;
    /** The file's name as the sender sealed it, or null when the row would not open. */
    name: string | null;
    /** The file's real plaintext length, when the sender recorded one. */
    size: number | null;
    /** The sender's address, in readable form — only ever set when the open SUCCEEDED. */
    sender: string | null;
    /** The file's own key. Present only when it opened; the caller wipes it. */
    dek: Uint8Array | null;
    /** The sealed digest, carried through so a download can check the bytes. */
    digestCt: string;
    /** Why it did not open, for a row that must still be listed. */
    problem: string | null;
}
/**
 * Open one received share.
 *
 * ⛔ A ROW THAT WILL NOT OPEN IS STILL RETURNED. Dropping it would tell the account it was sent
 *    less than it was, and the honest answer to "this one will not open" is to say so on its own
 *    line — not to leave a gap somebody has no way to notice.
 */
export declare function openReceived(crypt: CryptoGlue, keys: ShareKeys, row: ReceivedRow): OpenedShare;
/** The digest a recipient checks the downloaded bytes against. */
export declare function openSharedDigest(crypt: CryptoGlue, dek: Uint8Array, digestCt: string): Uint8Array | null;
/**
 * Turn what a person typed into the 16 bytes behind a public code.
 *
 * ⛔ A TYPO FAILS HERE, NOT AS A LOOKUP. Sending a mistyped address to the server would ask it a
 *    question about somebody who might exist, and the answer is not ours to collect.
 */
export declare function addressFromTyped(crypt: CryptoGlue, typed: string): Uint8Array;
/**
 * Check that an identity the server handed back is the one that was asked for.
 *
 * The engine checks this again inside the wrap, and this exists so the refusal says WHICH thing
 * was wrong rather than failing inside a sealing step.
 */
export declare function identityMatches(crypt: CryptoGlue, identity: Uint8Array, address: Uint8Array): boolean;
