import type { CryptoGlue } from "./crypto.ts";
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
export declare const DEFAULT_PART_BYTES: number;
/**
 * What NCF-3 adds to a part's plaintext: a fixed header, and one tag per chunk.
 *
 * ⛔ NOT MEASURED, BECAUSE THE ONE CALLER NEEDS IT BEFORE SEALING: the price is quoted, and
 *    `--dry-run` answers, without a very large file ever being read. A test seals real plaintexts
 *    with the real engine and compares, so this is held against the format rather than against a
 *    copy of these numbers.
 */
export declare const NCF3_SHAPE: {
    readonly headerLen: 72;
    readonly tagLen: 16;
    readonly chunkSize: number;
};
/** How many bytes one sealed part of this plaintext length occupies. */
export declare function sealedLenFor(plaintextLen: number): number;
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
export declare function plaintextLenFromSealed(sealedLen: number): number;
/** Everything an upload needs about one file, and nothing that identifies it. */
export interface SealedFile {
    /** The complete NCF-3 stream — header, chunks, end mark. These are the bytes that get stored. */
    sealed: Uint8Array;
    /** The file's own key wrapped under the account's data key (base64url envelope). */
    dekWrapped: string;
    /** SHA-256 of the plaintext, sealed under the account's data key (base64url envelope). */
    contentHashCt: string;
    /** Plaintext length — what the file list records, and what a reader reassembles to. */
    plaintextLen: number;
    /** Sealed length — what the server is told, what storage is bought for, what credits count. */
    sealedLen: number;
}
/** The three secrets a file carries, made once and reused by every one of its parts. */
export interface FileSecrets {
    /**
     * The file's own key, raw.
     *
     * ⛔ THE CALLER WIPES IT. Every part of a file is sealed under this one key, so it has to outlive
     *    the first part — which means nothing here can wipe it, and the loop that uses it must.
     */
    dek: Uint8Array;
    /** The same key wrapped under the account's data key (base64url envelope). */
    dekWrapped: string;
    /** The plaintext's SHA-256, sealed under the account's data key (base64url envelope). */
    contentHashCt: string;
}
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
export declare function fileSecrets(crypt: CryptoGlue, dataKey: Uint8Array, contentDigest: Uint8Array): FileSecrets;
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
export declare function sealPart(crypt: CryptoGlue, dek: Uint8Array, chunks: AsyncIterable<Uint8Array>, placement: {
    index: number;
    total: number;
    plaintextLen: number;
}): Promise<Uint8Array>;
/**
 * Seal a whole file held in memory, as one part.
 *
 * ⛔ THE DATA KEY IS BORROWED, NOT KEPT. The caller derived it and the caller wipes it; this
 *    function does not hold a reference past its own return. The file key it makes IS wiped here,
 *    because nothing outside needs it — the wrapped copy is what travels.
 */
export declare function sealFile(crypt: CryptoGlue, dataKey: Uint8Array, plaintext: Uint8Array): Promise<SealedFile>;
