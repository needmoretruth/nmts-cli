import { manifestFingerprint, type AccountSettings, type Manifest, type ManifestEntry } from "./manifest-codec.ts";
/**
 * Envelope AAD for ONE CHUNK of the chunked file list (NCF-3 §2, §6.3). Its own label, distinct
 * from `AAD_FILE_LIST`, so a chunk can never be presented as an index or an index as a chunk —
 * the server holds both as opaque bytes of the same shape.
 */
export declare const AAD_FILE_LIST_CHUNK = "nmts/v3/file-list-chunk";
/** The version an index and its chunks carry. Version 1 is the single blob `manifest-codec` reads. */
export declare const FILE_LIST_VERSION_CHUNKED = 2;
/** Compression flag 0x02 — zstd (NCF-3 §6.3.4). 0x00 and 0x01 are `manifest-codec`'s. */
export declare const FLAG_ZSTD = 2;
/**
 * The plaintext bound for ONE CHUNK (NCF-3 §6.3.3).
 *
 * On the PLAINTEXT and not on the sealed size, so a writer can decide where to close a chunk
 * before it compresses or seals anything: 3,900,000 bytes plus the flag byte plus the 72-byte
 * envelope is under the server's 4 MiB ceiling by construction, and a compressed chunk is smaller
 * still. The unused remainder is left unused — an entry is never split across two chunks.
 */
export declare const CHUNK_PLAIN_MAX = 3900000;
/**
 * The plaintext bound for the INDEX.
 *
 * The index sits where the single blob sat, so it inherits that ceiling (16 MiB sealed · §8.291).
 * It holds one ~110-byte row per chunk plus the account settings, so nothing an account can do
 * brings it near this; the number exists so a reader has a bound to check a compressed frame
 * against instead of trusting what the frame claims about itself.
 */
export declare const INDEX_PLAIN_MAX = 15000000;
/** One row of the index: a chunk's name and the range of entries it holds. */
export interface ManifestChunkRef {
    /** base64url SHA-256 of THIS CHUNK's transport string — its name and its pin. */
    h: string;
    /** How many entries it holds. */
    n: number;
    /** Placement key of its first entry (`manifest-pack.ts`). */
    f: string;
    /** Placement key of its last entry. */
    l: string;
}
/** The index — everything version 1 kept except the entries themselves (NCF-3 §6.3.1). */
export interface ManifestIndexV2 {
    v: typeof FILE_LIST_VERSION_CHUNKED;
    /** The store version this index was sealed at, as §6.1. */
    seq: number;
    /** base64url SHA-256 of the parent INDEX's transport string; absent at version 1. */
    p?: string;
    /** Account-level settings, moved here from beside the entries. */
    settings?: AccountSettings;
    /** In placement order. Empty for an account with no items. */
    chunks: readonly ManifestChunkRef[];
}
/** One chunk (NCF-3 §6.3.2). Immutable: an edit produces a new chunk with a new hash. */
export interface ManifestChunkDoc {
    v: typeof FILE_LIST_VERSION_CHUNKED;
    /**
     * The index version this chunk was written FOR — not the current one. A chunk untouched for a
     * hundred saves still says the version that made it, and that is correct: the index is what says
     * which chunks make up version 141.
     */
    seq: number;
    /** Entries exactly as version 1 carried them, in placement order. */
    items: readonly ManifestEntry[];
}
/** What a sealed file-list blob turned out to be. The reader decides by `v`, never by guessing. */
export type FileListDocument = {
    v: 1;
    manifest: Manifest;
} | {
    v: typeof FILE_LIST_VERSION_CHUNKED;
    index: ManifestIndexV2;
};
/**
 * A chunk's name. The SAME function the parent link uses, deliberately: both commit to the
 * base64url transport string rather than the bytes it encodes, because the string is what travels
 * and the encoding is canonical (fixed alphabet, no padding, one string per byte sequence).
 */
export declare const chunkFingerprint: typeof manifestFingerprint;
/** The index → the plaintext to seal under `AAD_FILE_LIST`. */
export declare function encodeIndex(index: ManifestIndexV2): Promise<Uint8Array>;
/** Sealed plaintext → the index. Throws `ManifestFormatError` on anything it cannot read. */
export declare function decodeIndex(body: Uint8Array): Promise<ManifestIndexV2>;
/** A chunk → the plaintext to seal under `AAD_FILE_LIST_CHUNK`. */
export declare function encodeChunk(doc: ManifestChunkDoc): Promise<Uint8Array>;
/** Sealed chunk plaintext → its entries. */
export declare function decodeChunk(body: Uint8Array): Promise<ManifestChunkDoc>;
/**
 * The reader's one door: sealed plaintext → whichever version it turned out to be.
 *
 * ⚠ A version-1 body is inflated twice — once here to read `v`, once by `decodeManifest`. That is
 * deliberate rather than a duplicate validator: version 1's rules live in one place and stay
 * there. The cost is bounded and self-extinguishing, because the first save after a version-1 load
 * converts the account (§6.3.6) and no later read takes this branch.
 */
export declare function decodeFileList(body: Uint8Array): Promise<FileListDocument>;
