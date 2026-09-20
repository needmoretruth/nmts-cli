/** Where to talk, what the server answers to, and the proof the three account doors ask for. */
export interface OpenerAccess {
    server: string;
    /** The API key or delegation token this client speaks with. */
    apiKey: string;
    /** The account code's own proof for this one run, base64url (`x-nmts-account-proof`). */
    accountProof: string;
}
/**
 * One opener as its own account sees it.
 *
 * ⛔ NO SLOT BYTES. The list says what roads exist, not what is inside them; the one caller that
 *    needs the bytes asks for them by locator, without a credential.
 */
export interface OpenerInfo {
    /** The name the server files it under, unpadded base64url. */
    locator: string;
    /**
     * What kind of thing opens it.
     *
     * ⚠ `other` IS NOT A THIRD FEATURE — it is what a kind this version has no name for is called.
     *   A list that quietly dropped such a row, or called it one of the two it knows, would be
     *   under-reporting the roads into an account, which is the one thing this list must not do.
     */
    kind: "wallet" | "passkey" | "other";
    /** When it was added, as the server spells it (RFC 3339, UTC). */
    createdAt: string;
}
/** What this account holds, and how many it may. */
export interface OpenerListing {
    openers: OpenerInfo[];
    /** The ceiling the server enforces, so a caller can say "3 of 8" without holding an 8 of its own. */
    cap: number;
}
/** Slot kind: a Sui wallet's signature over the opener message. */
export declare const KIND_WALLET = 1;
/** Slot kind: a WebAuthn passkey's PRF output. Reserved; nothing in this package writes one. */
export declare const KIND_PASSKEY = 2;
/** Every opener on this account. */
export declare function listOpeners(access: OpenerAccess): Promise<OpenerListing>;
/**
 * Store or replace the slot filed under this locator.
 *
 * ⚠ REPLACING IS NOT AN ACCIDENT. The same wallet re-wrapping its own slot — a new message version,
 *   a new derivation — writes the same locator and must overwrite rather than be refused as one
 *   opener too many.
 */
export declare function putOpener(access: OpenerAccess, locator: string, kind: number, slot: Uint8Array): Promise<void>;
/**
 * Take one road into the account away.
 *
 * ⛔ IT IS "FROM NOW ON", NOT "AS IF IT NEVER KNEW". A wallet that has opened this account once has
 *    held the NMTS key; removing its slot stops it opening the account again and cannot unknow
 *    what it learned. The sentence saying so belongs to whoever asked — it is not the server's and
 *    it is not this file's.
 */
export declare function removeOpener(access: OpenerAccess, locator: string): Promise<void>;
/**
 * The sealed bytes filed under this locator, or `null` when the server has none.
 *
 * ⛔ NO CREDENTIAL AND NO ACCOUNT ID GOES WITH IT, and none comes back: the answer is the slot and
 *    nothing else. `null` covers every reason the server has to refuse it — unknown, malformed, or
 *    an account since erased — because telling them apart is a way to learn which names exist.
 */
export declare function fetchSlot(server: string, locator: string): Promise<Uint8Array | null>;
