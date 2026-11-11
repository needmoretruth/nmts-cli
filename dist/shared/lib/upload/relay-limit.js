// How large one part may be, from the one thing that carries it: the storage network's upload relay.
//
// ⛔ THE RELAY REFUSES A BODY OVER 1 GiB, AND IT DOES SO AFTER THE MONEY HAS MOVED. Every Walrus
//    upload on every rail goes through a relay as one PUT whose body is the sealed part. The relay
//    hardcodes `DefaultBodyLimit::max(1024 * 1024 * 1024)` (walrus-upload-relay, `controller.rs`,
//    read 2026-11-11; not a config value), and the PUT comes after the register transaction that
//    buys the storage. Measured on the testnet relay on 2026-11-11: a 1 GiB plaintext part seals to
//    1,073,745,992 bytes, the full body was sent, and the relay answered 413 "length limit
//    exceeded" with the register already paid (docs/research/2026-11-11-part-size-measured.md).
//    For two months the browser's default part was exactly that 1 GiB.
//
// ⛔ SO THE LIMIT IS CHECKED ON THE SEALED PART, PADDING INCLUDED, BEFORE ANYTHING IS SIGNED. Sealing
//    adds a header and a tag per 4 MiB chunk, and the final part is rounded up by the padding rule
//    the account chose — `pow2` takes a 600 MiB final part to 1 GiB. A part size is allowed only if
//    the largest part it can produce, under every rule, still fits.
//
// It is copied verbatim into the command-line tool (`deploy/gen-cli-shared.mjs`), so the browser,
// the command and the SDK refuse the same sizes. Its only import is the padding arithmetic, which
// is copied with it.
import { paddedPlaintextLen, sealedLenFor } from "../crypto/size-padding.js";
/** Largest request body the Walrus upload relay accepts, in bytes (hardcoded in the relay). */
export const RELAY_BODY_LIMIT_BYTES = 2 ** 30;
/**
 * What NCF-3 adds to one part: a 72-byte header, and a 16-byte tag per 4 MiB chunk
 * (CRYPTO-FORMAT-NCF3.md §4.1). Each program's own sealing constants are tested equal to this.
 */
export const NCF3_PART_SHAPE = { headerLen: 72, tagLen: 16, chunkSize: 4 * 2 ** 20 };
/**
 * The billing unit the free padding floor fills up to (one credit's worth of bytes). Each
 * program's own `CREDIT_BYTES` is tested equal to this.
 */
export const PADDING_UNIT_BYTES = 2 ** 20;
const RULES = ["padme", "pow2", "none"];
/**
 * The largest relay body a part size can produce: a full part, or a final part padded by any rule.
 * Padding only ever grows with the length, so the full-size final part is the worst case.
 */
export function largestSealedPartBytes(partSizeBytes) {
    if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) {
        throw new RangeError(`a part size must be a positive whole number of bytes, got ${String(partSizeBytes)}`);
    }
    let largest = sealedLenFor(partSizeBytes, NCF3_PART_SHAPE);
    for (const rule of RULES) {
        const padded = paddedPlaintextLen(partSizeBytes, rule, { unitBytes: PADDING_UNIT_BYTES, shape: NCF3_PART_SHAPE });
        largest = Math.max(largest, sealedLenFor(padded, NCF3_PART_SHAPE));
    }
    return largest;
}
/** True when every part this size can produce goes through the relay. */
export function partFitsRelay(partSizeBytes) {
    return largestSealedPartBytes(partSizeBytes) <= RELAY_BODY_LIMIT_BYTES;
}
/**
 * The largest whole-MiB part size that fits, derived from the two numbers above: 512 MiB, because
 * `pow2` pads anything larger to 1 GiB and 1 GiB plus its envelope is over the limit.
 */
export const MAX_PART_SIZE_BYTES = (() => {
    for (let mib = RELAY_BODY_LIMIT_BYTES / 2 ** 20; mib > 0; mib -= 1) {
        if (partFitsRelay(mib * 2 ** 20))
            return mib * 2 ** 20;
    }
    throw new RangeError("no part size fits the relay");
})();
/**
 * Throw before anything is priced or signed when a part size could produce a part the relay will
 * refuse. The message names both numbers so a caller sees what to choose instead.
 */
export function requirePartFitsRelay(partSizeBytes) {
    if (!partFitsRelay(partSizeBytes)) {
        throw new RangeError(`A part of ${partSizeBytes} bytes can seal to ${largestSealedPartBytes(partSizeBytes)} bytes, ` +
            `over the upload relay's ${RELAY_BODY_LIMIT_BYTES}-byte limit. ` +
            `Choose ${MAX_PART_SIZE_BYTES} bytes (${MAX_PART_SIZE_BYTES / 2 ** 20} MiB) or less.`);
    }
}
