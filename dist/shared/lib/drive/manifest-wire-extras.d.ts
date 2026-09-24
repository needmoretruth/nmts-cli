/**
 * One share this device made, kept where the server cannot reach it (`ManifestEntry.shares`).
 *
 * A receipt is written only AFTER the server's created row was checked to carry the very address
 * the sender typed — so what is stored is the address she asked for, never one the server chose.
 */
export interface ShareReceipt {
    /** Recipient address in WIRE form: exactly what the create call was checked against. */
    address: string;
    /** When this device wrote the receipt, ms since the Unix epoch. This browser's clock. */
    at: number;
    /**
     * A revoke was sent for this receipt and the listing has not yet come back without the row.
     *
     * The receipt outlives the revoke ON PURPOSE: a revoke this side cannot verify is exactly the
     * case worth keeping, and a listing that still carries the address is the only evidence the
     * removal did not happen. Dropped once a listing no longer names it (`sharePrune`), which is
     * what keeps this array from growing forever.
     */
    revoked?: true;
}
/** One share receipt on the wire. Same short-key reason as the entry it sits on. */
export interface WireShareReceipt {
    /** address. */
    a: string;
    /** at. */
    t: number;
    /** revoked. */
    r?: 1;
}
export declare function sharesToWire(shares: readonly ShareReceipt[]): WireShareReceipt[];
/**
 * Receipts that can be checked, or `undefined` when none can.
 *
 * Defensive for a sharp reason: a receipt with a blank address or a broken instant would be
 * compared against the server's rows and could produce a warning about a share nobody ever made.
 * Anything unusable is dropped — a receipt that cannot be checked says nothing, and saying nothing
 * is the honest outcome.
 */
export declare function sharesFromWire(raw: unknown): ShareReceipt[] | undefined;
/**
 * Every entry key this build reads. ⛔ A key added to `WireEntry` and not here would ALSO be
 * carried, and a mark this build clears would come back from the carried copy on the next save —
 * the codec test pins the two lists together.
 */
export declare const KNOWN_ENTRY_KEYS: ReadonlySet<string>;
/** The keys of a wire entry this build does not know, or `undefined` when there are none. */
export declare function carriedFromWire(w: object): Readonly<Record<string, unknown>> | undefined;
/** `w` with the carried keys laid UNDER it — a key this build writes always wins over one it carries. */
export declare function withCarried<T extends object>(w: T, carried: Readonly<Record<string, unknown>> | undefined): T;
