export interface PartRange {
    /**
     * Zero-based position of this part in the file.
     *
     * It orders the download AND is sealed into the part's own header, so a storage service cannot
     * reorder parts or serve one in another's place without the decryption failing.
     */
    partIndex: number;
    /** Where this part starts in the plaintext, inclusive. */
    offset: number;
    /** How many plaintext bytes this part carries. Becomes the declared length in its header. */
    length: number;
}
/**
 * Split a plaintext length into ordered, contiguous, non-overlapping ranges of at most
 * `partSizeBytes` each; the last one carries the remainder.
 *
 * The ranges tile `[0, plaintextLen)` exactly — the lengths sum to `plaintextLen` — and a file that
 * fits in one part is simply the one-range case, so a caller never needs a separate path for it.
 *
 * Throws on a non-positive length or part size rather than coercing: both are caller mistakes, and
 * a silently corrected one would produce a plan that does not describe the file.
 */
export declare function planParts(plaintextLen: number, partSizeBytes: number): PartRange[];
