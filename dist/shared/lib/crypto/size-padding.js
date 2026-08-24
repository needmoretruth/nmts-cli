// Rounding a file's stored size up, so the exact length of what somebody stored is not published.
//
// A sealed stream states the length it was sealed from, in the clear, at a fixed place in its
// header. That header is authenticated but not encrypted — it has to be readable to be decrypted
// against — so on a public storage network the exact byte length of every stored file is legible to
// anyone who fetches it. Padding is what takes that away: seal from a rounded-up length, and the
// number on the wire is the rounded one.
//
// ⛔ ONLY THE FINAL PART OF A FILE MAY BE PADDED. A reader recovers each part's real length from
//    the file's own size and the lengths the stored streams declare, and that answer is unique only
//    because every earlier part is exactly full. Padding one of them would not be caught here — it
//    would be caught years later, by a download that wrote padding into the middle of a file.
//
// ⛔ TWO PROGRAMS MUST ROUND THE SAME WAY. This is copied verbatim into other programs; a file
//    uploaded by one and one uploaded by the other must not be tellable apart by the shape of their
//    lengths, or the padding has replaced one fingerprint with another.
//
// It depends on nothing, and the two numbers it needs about the sealing format are arguments rather
// than imports, so that the program using it supplies the ones its own sealing actually uses.
/**
 * Padmé: round up to a multiple of 2^(E−S), where E = floor(log2 L) and S = floor(log2 E)+1.
 *
 * About 32 possible lengths per doubling, for roughly 1% more storage. Lengths below 4 are
 * returned unchanged — the step there would be a single byte, which hides nothing.
 */
export function padmeLen(len) {
    if (len < 4)
        return len;
    const e = Math.floor(Math.log2(len));
    const s = Math.floor(Math.log2(e)) + 1;
    const z = e - s;
    if (z <= 0)
        return len;
    const step = 2 ** z;
    return Math.ceil(len / step) * step;
}
/** The next power of two at or above `len`: one possible length per doubling. Below 2, unchanged. */
export function pow2Len(len) {
    if (len < 2)
        return len;
    return 2 ** Math.ceil(Math.log2(len));
}
/** Chunks a stream of this plaintext length splits into. Empty is one chunk, not zero. */
export function chunkCount(plaintextLen, shape) {
    return plaintextLen === 0 ? 1 : Math.ceil(plaintextLen / shape.chunkSize);
}
/** How many bytes one sealed stream of this plaintext length occupies. */
export function sealedLenFor(plaintextLen, shape) {
    return shape.headerLen + plaintextLen + shape.tagLen * chunkCount(plaintextLen, shape);
}
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
export function freeCeiling(len, unitBytes, shape) {
    if (unitBytes <= 0)
        return len;
    const paidBytes = Math.ceil(sealedLenFor(len, shape) / unitBytes) * unitBytes;
    // Invert the sealed-length arithmetic conservatively: assume the padded stream needs one more
    // chunk than the real one might, then walk back until the sealed length actually fits. At most
    // two steps.
    let chunks = Math.max(1, Math.ceil((paidBytes - shape.headerLen) / shape.chunkSize));
    for (;;) {
        const candidate = paidBytes - shape.headerLen - shape.tagLen * chunks;
        if (candidate >= len && sealedLenFor(candidate, shape) <= paidBytes)
            return candidate;
        if (chunks <= 1)
            return len;
        chunks -= 1;
    }
}
/**
 * The plaintext length to seal a final part from. Never smaller than `len`.
 *
 * ⛔ FINAL PART ONLY — see the module note.
 */
export function paddedPlaintextLen(len, rule, options) {
    if (!Number.isSafeInteger(len) || len < 0) {
        throw new RangeError(`padded length needs a non-negative safe integer, got ${len}`);
    }
    const byRule = rule === "pow2" ? pow2Len(len) : padmeLen(len);
    return Math.max(len, byRule, freeCeiling(len, options.unitBytes, options.shape));
}
/**
 * Each part's REAL contributed length, from the file's real size and what each stored stream
 * declares. The read side of the same contract, and the only place that arithmetic is written.
 *
 * Throws rather than repairing. Numbers that do not reconcile would hand back a file with bytes
 * missing or padding in the middle of it, and neither announces itself afterwards.
 */
export function keepLengths(size, streamLens) {
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new RangeError(`a file size must be a non-negative safe integer, got ${size}`);
    }
    if (streamLens.length === 0) {
        throw new RangeError("a file with no parts has nothing to keep");
    }
    const keep = [];
    let remaining = size;
    for (let i = 0; i < streamLens.length; i += 1) {
        const declared = streamLens[i] ?? 0;
        if (!Number.isSafeInteger(declared) || declared < 0) {
            throw new RangeError(`part ${i} declares a length that is not a byte count: ${declared}`);
        }
        const isLast = i === streamLens.length - 1;
        const take = isLast ? remaining : declared;
        if (take > declared) {
            throw new RangeError(`part ${i} must contribute ${take} bytes but its stream only holds ${declared}`);
        }
        if (take > remaining) {
            throw new RangeError(`part ${i} contributes ${take} bytes but only ${remaining} of the file are left`);
        }
        keep.push(take);
        remaining -= take;
    }
    // No total check follows, and none is possible to write honestly: the last part is GIVEN whatever
    // is left, so the sum is `size` by construction. A file whose parts fall short shows up one line
    // above, as a last part whose stream cannot hold what remains.
    return keep;
}
