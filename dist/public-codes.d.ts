import type { CryptoGlue } from "./crypto.ts";
/** One code as `GET /v1/account/public-codes` lists it. */
export interface PublicCodeRow {
    index: number;
    /** The 16-byte address, base64url, as the wire carries it. */
    address: string;
    createdAt: string;
    /** When it was revoked, or null while it is live. */
    revokedAt: string | null;
    /** Shares sent from it, shares received with it, support threads that carry it. */
    sent: number;
    received: number;
    support: number;
}
/** The whole answer: every code this account ever published, and the two ceilings on making more. */
export interface PublicCodeList {
    codes: PublicCodeRow[];
    /** How many may be live at once — 3, or 1 for a Platform user. */
    liveMax: number;
    /** How many new ones this account may make per UTC day, and how many it has made today. */
    dayCap: number;
    madeToday: number;
}
/** How many numbers in a row publishing walks past before it stops. */
export declare const PUBLISH_TRIES = 64;
/** `GET /v1/account/public-codes`, read field by field. Codes come back in number order. */
export declare function readPublicCodes(server: string, token: string): Promise<PublicCodeList>;
/** The live codes, lowest number first. */
export declare function liveCodes(list: PublicCodeList): PublicCodeRow[];
/** The code this account shows and sends from unless told otherwise: its lowest-numbered live one. */
export declare function defaultCode(list: PublicCodeList): PublicCodeRow | null;
/** The number a new code gets: one past the highest ever published, or 0 for an account with none. */
export declare function nextCodeIndex(list: PublicCodeList): number;
/** Where a request goes and what it carries. */
export interface CodeDoor {
    server: string;
    token: string;
}
/** What publishing answers: the number it landed on and the code a person reads. */
export interface PublishedCode {
    index: number;
    /** The grouped form a person reads and types. */
    code: string;
    /** The 16 bytes, base64url. */
    address: string;
}
/**
 * Publish this key's code at `from` (default: the next number), revoking `replace` in the same
 * request when it is given. Walks past numbers the server says were revoked, up to `PUBLISH_TRIES`.
 *
 * ⛔ THE IDENTITY IS DERIVED HERE AND NOWHERE ELSE. There is no form of this that takes an identity
 *    from a caller: what goes to the server is what this key makes at that number.
 */
export declare function publishCode(crypt: CryptoGlue, code: string, door: CodeDoor, from: number, replace?: number): Promise<PublishedCode>;
/**
 * Make sure the account has a live code, publishing the next number when it has none — what a
 * first share does before anything else. Answers the list as it now stands, and whether it wrote.
 */
export declare function ensureLiveCode(crypt: CryptoGlue, code: string, door: CodeDoor, onPublish?: () => void): Promise<{
    list: PublicCodeList;
    published: PublishedCode | null;
}>;
/** One bucket of the server's revoked list, fetched once per lookup that shares it. */
export type RevokedBuckets = Map<string, Promise<Uint8Array[]>>;
/**
 * Whether the code at `address` is on the server's revoked list — or null when the list could not
 * be read (offline, rate-limited, an older server), which is "unknown", not "live".
 *
 * ⛔ ASKED BY BUCKET, NEVER BY CODE. The server keeps SHA-256 of each revoked address; this fetches
 *    every mark whose hex starts with the same digit as this address's mark (one of sixteen) and
 *    compares here. A question about one code would tell the server who is dealing with whom — the
 *    thing a handover exists not to tell it. Needs no credential.
 */
export declare function revokedOnServer(server: string, address: Uint8Array, buckets?: RevokedBuckets): Promise<boolean | null>;
/** `POST /v1/account/public-codes/{index}/revoke`. One way: nothing brings a code back. */
export declare function revokeCode(door: CodeDoor, index: number): Promise<void>;
