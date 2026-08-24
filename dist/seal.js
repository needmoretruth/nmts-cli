// Turning a local file into the three things an upload needs: sealed bytes, a wrapped key, and a
// hash the account can check the bytes against later.
//
// ⛔ NOTHING HERE TOUCHES THE NETWORK OR THE CLOCK. It is a pure function of (plaintext, data key)
//    plus the one random file key the engine makes, which is what lets the tests drive it with
//    fixed inputs and compare against what `get` recovers.
//
// ⛔ THE PLAINTEXT NEVER LEAVES THIS PROCESS. What goes out is the NCF-3 stream; what the server
//    is told is its LENGTH. The name, the folder and the real size are written into the account's
//    sealed file list, which the server cannot open.
import { createHash } from "node:crypto";
import { AAD } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { chunkCount, sealedLenFor as sealedLength, } from "./shared/lib/crypto/size-padding.js";
/**
 * How much of a file goes into ONE part, unless the caller says otherwise.
 *
 * ⛔ IT IS A MEMORY BOUND, NOT A PRODUCT LIMIT. Sealing holds a part's ciphertext, and the storage
 *    network's erasure coding then expands it about fivefold while it computes the blob id — so a
 *    part costs several times its own size in memory before a single byte is sent. The file itself
 *    is never held: it is read a slice at a time.
 *
 * ⚠ THIS NUMBER USED TO BE THE WHOLE FILE'S CEILING, and keeping it as the part size is deliberate.
 *   It means growing past one part cannot make an upload that worked yesterday run out of memory
 *   today — the most memory this tool asks for is the same as it always was.
 *
 * Bigger parts mean fewer reservations, and every reservation counts against the account's daily
 * spending allowance; smaller parts mean less memory and a shorter piece of work to lose when
 * something goes wrong. `put --part-size` is how somebody picks a different trade.
 */
export const DEFAULT_PART_BYTES = 64 * 2 ** 20;
/**
 * What NCF-3 adds to a part's plaintext: a fixed header, and one tag per chunk.
 *
 * ⛔ NOT MEASURED, BECAUSE THE ONE CALLER NEEDS IT BEFORE SEALING: the price is quoted, and
 *    `--dry-run` answers, without a very large file ever being read. A test seals real plaintexts
 *    with the real engine and compares, so this is held against the format rather than against a
 *    copy of these numbers.
 */
export const NCF3_SHAPE = {
    headerLen: 72,
    tagLen: 16,
    chunkSize: 4 * 2 ** 20,
};
/** How many bytes one sealed part of this plaintext length occupies. */
export function sealedLenFor(plaintextLen) {
    if (!Number.isSafeInteger(plaintextLen) || plaintextLen < 0) {
        throw new NmtsError(`A plaintext length must be a non-negative whole number: ${plaintextLen}.`);
    }
    return sealedLength(plaintextLen, NCF3_SHAPE);
}
/**
 * The plaintext length a sealed part of this size was sealed FROM.
 *
 * ⛔ WHY THE INVERSE EXISTS. The server is told what a part OCCUPIES and nothing about the file
 *    behind it, and it is the only number it can serve back. A recovery list records the length
 *    the stored stream DECLARES, because that is what a reader checks the fetched header against —
 *    so somewhere the one number has to become the other, and this is that place. It sits beside
 *    the forward arithmetic rather than in a module of its own so that the two can never be
 *    changed apart.
 *
 * ⛔ IT REFUSES RATHER THAN ROUNDS. Every reachable sealed length has exactly one plaintext length
 *    behind it, and the lengths between them are not reachable at all — a stream of n chunks ends
 *    where the next one's first tag would begin. The one caller that matters is the recovery
 *    list's own integrity check, where a lenient answer would be the failure it exists to catch.
 *
 * ⚠ RESTATED FROM `web/src/lib/crypto/sealed-size.ts::plaintextLenFromSealed`, which this package
 *   cannot import (zero imports across the two trees). Only the SEARCH is restated: each candidate
 *   is confirmed with `chunkCount` from the shared byte-for-byte copy, so the formula itself still
 *   lives in one file.
 */
export function plaintextLenFromSealed(sealedLen) {
    if (!Number.isSafeInteger(sealedLen)) {
        throw new NmtsError(`A sealed length must be a whole number: ${sealedLen}.`);
    }
    const body = sealedLen - NCF3_SHAPE.headerLen;
    const per = NCF3_SHAPE.chunkSize + NCF3_SHAPE.tagLen;
    // Chunk counts grow with the length, so the right one is within a step of this estimate; each
    // candidate is checked against the forward formula rather than trusted.
    const estimate = Math.max(1, Math.ceil((body - NCF3_SHAPE.tagLen) / per));
    for (const chunks of [estimate - 1, estimate, estimate + 1]) {
        if (chunks < 1)
            continue;
        const plaintext = body - NCF3_SHAPE.tagLen * chunks;
        if (plaintext >= 0 && chunkCount(plaintext, NCF3_SHAPE) === chunks)
            return plaintext;
    }
    throw new NmtsError(`${sealedLen} is not a length any NCF-3 stream can have.`);
}
const encoder = new TextEncoder();
/**
 * Make a file's key and seal the hash of its contents.
 *
 * ⛔ THE HASH IS OF THE PLAINTEXT, AND IT IS SEALED RATHER THAN STORED BARE. A bare content hash
 *    identifies the file itself: it is the same number for everyone who holds that file, and it is
 *    matchable against published hash sets. Sealed, it is checkable only by the account that wrote
 *    it — which is the only party that needs to check it.
 *
 * `contentDigest` is the SHA-256 of the whole plaintext, which the caller computes while reading
 * the file. Passing it in rather than the file is what lets this work for a file too large to hold.
 */
export function fileSecrets(crypt, dataKey, contentDigest) {
    if (contentDigest.length !== 32) {
        throw new NmtsError(`A content digest must be 32 bytes, got ${contentDigest.length}.`);
    }
    const dek = crypt.generate_dek();
    const dekWrapped = crypt.envelope_seal(dataKey, encoder.encode(AAD.dekWrap), dek);
    const contentHashCt = crypt.envelope_seal(dataKey, encoder.encode(AAD.contentHash), contentDigest);
    return {
        dek,
        dekWrapped: Buffer.from(dekWrapped).toString("base64url"),
        contentHashCt: Buffer.from(contentHashCt).toString("base64url"),
    };
}
/**
 * Seal ONE part of a file, reading its plaintext as it goes.
 *
 * ⛔ A FRESH SESSION, AND THEREFORE A FRESH NONCE, EVERY TIME. The format requires each part to be
 *    its own stream under its own nonce prefix; the engine allocates one inside the session and
 *    there is no way from here to reuse one. That is the property that makes a re-sealed part a
 *    DIFFERENT blob — which is exactly why a resumed upload pushes the bytes it wrote down rather
 *    than sealing again.
 *
 * ⛔ THE DECLARED LENGTH IS CHECKED AGAINST WHAT ARRIVES. The engine refuses to finish a stream
 *    that was fed too little; too much is caught here. A part whose header declares a length its
 *    bytes do not match is a file that reassembles wrong, and the reader would not find out until
 *    the download.
 */
export async function sealPart(crypt, dek, chunks, placement) {
    const { index, total, plaintextLen } = placement;
    if (plaintextLen <= 0) {
        throw new NmtsError("An empty part cannot be sealed.", {
            nextStep: "The storage network has nothing to store and would refuse the reservation.",
        });
    }
    const sealer = new crypt.StreamEncryptor(dek, plaintextLen, index, total);
    try {
        const out = [sealer.header()];
        let seen = 0;
        for await (const chunk of chunks) {
            seen += chunk.length;
            if (seen > plaintextLen) {
                throw new NmtsError(`Part ${index + 1} of ${total} was given more bytes than it declared (${plaintextLen}).`, { nextStep: "Nothing was sent. The file changed while it was being read." });
            }
            out.push(sealer.push(chunk));
        }
        if (seen !== plaintextLen) {
            throw new NmtsError(`Part ${index + 1} of ${total} declared ${plaintextLen} bytes and read ${seen}.`, { nextStep: "Nothing was sent. The file changed while it was being read." });
        }
        out.push(sealer.finish());
        return concat(out);
    }
    finally {
        // ⛔ THE ENGINE HOLDS THE KEY UNTIL THIS RUNS, including on the way out of a failed read.
        sealer.free();
    }
}
function concat(pieces) {
    let total = 0;
    for (const piece of pieces)
        total += piece.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const piece of pieces) {
        out.set(piece, at);
        at += piece.length;
    }
    return out;
}
/**
 * Seal a whole file held in memory, as one part.
 *
 * ⛔ THE DATA KEY IS BORROWED, NOT KEPT. The caller derived it and the caller wipes it; this
 *    function does not hold a reference past its own return. The file key it makes IS wiped here,
 *    because nothing outside needs it — the wrapped copy is what travels.
 */
export async function sealFile(crypt, dataKey, plaintext) {
    if (plaintext.length === 0) {
        throw new NmtsError("An empty file cannot be uploaded.", {
            nextStep: "The storage network has nothing to store and would refuse the reservation.",
        });
    }
    const digest = new Uint8Array(createHash("sha256").update(plaintext).digest());
    const secrets = fileSecrets(crypt, dataKey, digest);
    digest.fill(0);
    try {
        const sealed = await sealPart(crypt, secrets.dek, oneChunk(plaintext), {
            index: 0,
            total: 1,
            plaintextLen: plaintext.length,
        });
        return {
            sealed,
            dekWrapped: secrets.dekWrapped,
            contentHashCt: secrets.contentHashCt,
            plaintextLen: plaintext.length,
            sealedLen: sealed.length,
        };
    }
    finally {
        secrets.dek.fill(0);
    }
}
async function* oneChunk(bytes) {
    yield bytes;
}
