/** Bytes of one sealed part that decide the question (NCF-3 §4.1 header, §4.2 commitment). */
export declare const NCF3_HEADER_BYTES = 72;
/**
 * How many of these reads are in flight at once.
 *
 * Small on purpose: it is one tiny range request per file against the public aggregators, and a
 * rebuild is not a download — going wider would spend an account's whole read budget on 72-byte
 * requests and make the progress line lie about what is happening.
 */
export declare const REBUILD_VERIFY_CONCURRENCY = 4;
/** Why one pair could not be shown to belong together. */
export type UnverifiedReason = 
/** The server's row carries no wrapped key at all — nothing to pair, and nothing to check. */
"no-key"
/** The row names no stored part, so there is no header this key could be tried against. */
 | "no-parts"
/** The header could not be read (network, aggregator, an unknown storage network). */
 | "unreadable"
/** The header was read and this key does not open it — the pair is WRONG, not merely unproven. */
 | "wrong-key";
/** One item whose key was not shown to belong to it. */
export interface UnverifiedPair {
    readonly id: string;
    readonly reason: UnverifiedReason;
}
/** What one attempt to open a row's first part header came back with. */
export type PairVerdict = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: UnverifiedReason;
};
/** The least a row must expose to be checked. */
export interface RebuildRow {
    readonly id: string;
    /** The wrapped file key, absent on a row committed before the server kept one. */
    readonly dekWrapped?: string | undefined;
}
export interface VerifyPairingsInput<T extends RebuildRow> {
    readonly rows: readonly T[];
    /**
     * Read this row's FIRST sealed part's header prefix and try to open it with the row's own key.
     *
     * ⛔ IT MUST NOT THROW FOR AN ORDINARY FAILURE — a verdict is the answer, and `unreadable` is a
     *    verdict. A throw is still handled (as `unreadable`, never as a pass) so that a bug on the
     *    caller's side cannot turn into a list full of keys nobody checked.
     */
    openFirstPartHeader(row: T): Promise<PairVerdict>;
    /** In-flight reads. Defaults to REBUILD_VERIFY_CONCURRENCY; anything below 1 is raised to 1. */
    readonly concurrency?: number;
    /** Ticks as answers arrive, so a large account is not a silent wait. */
    onProgress?: (checked: number, total: number) => void;
}
export interface PairingVerdicts {
    /** Ids whose key was shown to open their own first part. Only these may be written with a key. */
    readonly verified: ReadonlySet<string>;
    /** Everything else, in the order the rows were given, each with why. */
    readonly unverified: readonly UnverifiedPair[];
}
/**
 * Decide, for every row, whether its key belongs to it.
 *
 * A row with no key is answered here rather than by the caller's reader: there is nothing to
 * fetch, and spending a request to learn that would be a request per keyless file.
 */
export declare function verifyKeyPairings<T extends RebuildRow>(input: VerifyPairingsInput<T>): Promise<PairingVerdicts>;
/**
 * True when this row's key may be written into the rebuilt list.
 *
 * Both rebuild paths ask this one question rather than each testing the set themselves, because
 * "which way round is the set" is exactly the kind of thing two copies get differently.
 */
export declare function mayCarryKey(id: string, verdicts: PairingVerdicts): boolean;
