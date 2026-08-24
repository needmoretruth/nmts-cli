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
export function planParts(plaintextLen, partSizeBytes) {
    if (!Number.isFinite(plaintextLen) || plaintextLen <= 0) {
        throw new RangeError(`planParts needs a positive plaintextLen, got ${String(plaintextLen)}`);
    }
    if (!Number.isFinite(partSizeBytes) || partSizeBytes <= 0) {
        throw new RangeError(`planParts needs a positive partSizeBytes, got ${String(partSizeBytes)}`);
    }
    const ranges = [];
    let offset = 0;
    let partIndex = 0;
    while (offset < plaintextLen) {
        const length = Math.min(partSizeBytes, plaintextLen - offset);
        ranges.push({ partIndex, offset, length });
        offset += length;
        partIndex += 1;
    }
    return ranges;
}
