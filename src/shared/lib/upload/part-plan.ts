// Splitting a file into parts — the arithmetic, and nothing else.
//
// A file too large for one stored object is split into independent parts, each encrypted as its own
// stream and stored as its own object. This module decides only WHERE the cuts fall. It holds no
// policy: which sizes get split, how big a part should be and what that costs are decided by the
// caller, because a browser and a command-line tool answer those questions differently — a browser
// bounds a part by what a tab can hold, a terminal by what the machine can.
//
// It is written to be copied verbatim into other programs, so it depends on nothing: no imports, no
// platform, no configuration. Two programs that split the same file must place the cuts in exactly
// the same places, because each part's position is sealed into its own header and authenticated
// with its contents. A part cut differently is not a slightly different upload — it is bytes that
// will not open in the position they were stored in.
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
export function planParts(plaintextLen: number, partSizeBytes: number): PartRange[] {
  if (!Number.isFinite(plaintextLen) || plaintextLen <= 0) {
    throw new RangeError(`planParts needs a positive plaintextLen, got ${String(plaintextLen)}`);
  }
  if (!Number.isFinite(partSizeBytes) || partSizeBytes <= 0) {
    throw new RangeError(`planParts needs a positive partSizeBytes, got ${String(partSizeBytes)}`);
  }
  const ranges: PartRange[] = [];
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
