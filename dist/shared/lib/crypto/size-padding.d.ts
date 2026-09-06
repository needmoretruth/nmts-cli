/** How coarsely a stored length is rounded up. */
export type PaddingRule = "padme" | "pow2";
/**
 * Padmé: round up to a multiple of 2^(E−S), where E = floor(log2 L) and S = floor(log2 E)+1.
 *
 * About 32 possible lengths per doubling, for roughly 1% more storage. Lengths below 4 are
 * returned unchanged — the step there would be a single byte, which hides nothing.
 */
export declare function padmeLen(len: number): number;
/** The next power of two at or above `len`: one possible length per doubling. Below 2, unchanged. */
export declare function pow2Len(len: number): number;
/** What sealing costs: a fixed header, plus one authentication tag per chunk. */
export interface SealingShape {
    headerLen: number;
    tagLen: number;
    chunkSize: number;
}
/** Chunks a stream of this plaintext length splits into. Empty is one chunk, not zero. */
export declare function chunkCount(plaintextLen: number, shape: SealingShape): number;
/** How many bytes one sealed stream of this plaintext length occupies. */
export declare function sealedLenFor(plaintextLen: number, shape: SealingShape): number;
/**
 * The largest plaintext length whose sealed stream still fits inside bytes already paid for.
 *
 * Storage for a file of its own is charged in whole units, so every byte between the real sealed
 * length and the next unit boundary has already been bought. Filling them is the one padding that
 * costs nothing at all, which is why it applies before any rule and whichever rule was chosen.
 *
 * `unitBytes` is the billing unit. Pass 0 when the bytes are not billed that way — a file sharing a
 * stored object with others is billed alongside them, and there is no free room to claim.
 */
export declare function freeCeiling(len: number, unitBytes: number, shape: SealingShape): number;
/**
 * The plaintext length to seal a final part from. Never smaller than `len`.
 *
 * ⛔ FINAL PART ONLY — see the module note.
 */
export declare function paddedPlaintextLen(len: number, rule: PaddingRule, options: {
    unitBytes: number;
    shape: SealingShape;
}): number;
/**
 * Each part's REAL contributed length, from the file's real size and what each stored stream
 * declares. The read side of the same contract, and the only place that arithmetic is written.
 *
 * Throws rather than repairing. Numbers that do not reconcile would hand back a file with bytes
 * missing or padding in the middle of it, and neither announces itself afterwards.
 */
export declare function keepLengths(size: number, streamLens: readonly number[]): number[];
