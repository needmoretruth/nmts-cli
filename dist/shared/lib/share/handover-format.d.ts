/** Wire values of the handover file. Fixed forever once a file carries them. */
export declare const HANDOVER_FORMAT = "nmts-handover";
export declare const HANDOVER_VERSION = 1;
/** Marker inside the sealed parts document. */
export declare const HANDOVER_PARTS_FORMAT = "nmts-handover-parts/1";
/** Marker of the name document — the §5.4 share document, which a handover extends by two keys. */
export declare const SHARE_FILE_FORMAT = "nmts-share-file/1";
/** Wire values of the public code file. */
export declare const PUBLIC_CODE_FORMAT = "nmts-public-code";
export declare const PUBLIC_CODE_VERSION = 1;
/** File name endings. */
export declare const HANDOVER_EXTENSION = ".nmtshandover";
export declare const PUBLIC_CODE_EXTENSION = ".nmtscode";
/**
 * What a person who opens the file in a text editor reads. Informational; not read back.
 * The two place names are the labels on the screen: the side panel entry and the button.
 */
export declare const HANDOVER_NOTE: readonly [string, string];
/** Size caps on the whole text, checked before it is parsed (§5.6, §5.7). */
export declare const MAX_HANDOVER_FILE_BYTES: number;
export declare const MAX_PUBLIC_CODE_FILE_BYTES: number;
/** Field bounds (§5.6). Together they keep a file under MAX_HANDOVER_FILE_BYTES. */
export declare const MAX_NAME_SEALED_LEN: number;
export type HandoverNetwork = "mainnet" | "testnet";
/** One handover file, every binary value still in its base64url text form. */
export interface HandoverFile {
    network: HandoverNetwork;
    /** The item id, lowercase, exactly as bound into the envelope. */
    item: string;
    /** The sender's published identity (4989 bytes). */
    sender: string;
    /** The share envelope (1240 bytes); its first 16 bytes are the sender's address. */
    envelope: string;
    /** The name document sealed under the file key. */
    name: string;
    /** The whole-file digest sealed under the file key (104 bytes). */
    hash: string;
    /** The parts document sealed under the file key. */
    parts: string;
}
/**
 * The name document a handover seals: the §5.4 share document plus the two values that bind the
 * rest of the file to the envelope. `payload_cmt` covers the sealed name, so these two are covered.
 */
export interface HandoverName {
    name: string;
    /** The file's real length. Required here, unlike a built-in share's document. */
    size: number;
    network: HandoverNetwork;
    /** SHA-256 of the sealed parts value (its bytes, not its text), unpadded base64url. */
    partsSha256: string;
}
/** One stored piece of the file, in order. A quilt patch names `patch`; a whole blob names `blob`. */
export interface HandoverPart {
    blob: string | null;
    patch: string | null;
    /** Bytes the sealed stream occupies. */
    len: number;
    /**
     * The piece's end epoch as the sender's drive recorded it when the file was made — exclusive:
     * the storage has ended once the current epoch reaches it. A hint, not a promise (the sender may
     * extend or delete the storage later); 0 means the drive did not know it.
     */
    exp: number;
}
/** The public code file. */
export interface PublicCodeFile {
    /** The public code in the form a person reads. */
    code: string;
    /** The published identity (4989 bytes), base64url. */
    identity: string;
}
/**
 * Why a file was refused:
 *   too-large        — over the size cap; not parsed at all
 *   not-json         — it is not a JSON object
 *   wrong-format     — it is JSON, but not this kind of file
 *   unknown-version  — this kind of file, with a version number above the one this reader knows
 *   other-network    — a handover file made on the other network
 *   bad-field        — the right kind and version, but a field (or `version` itself) is wrong
 */
export type HandoverFormatProblem = "too-large" | "not-json" | "wrong-format" | "unknown-version" | "other-network" | "bad-field";
export declare class HandoverFormatError extends Error {
    readonly problem: HandoverFormatProblem;
    /** The field at fault, for `bad-field`. */
    readonly field: string | null;
    constructor(problem: HandoverFormatProblem, field?: string | null);
}
/**
 * Bytes behind an unpadded base64url string, or null when it is not one in CANONICAL form: the
 * bits the last character carries beyond the data must be zero, so one byte string has one text.
 */
export declare function base64UrlByteLength(text: string): number | null;
/** `nmts-handover-<YYYY-MM-DD>.nmtshandover`, the date in UTC. The file's own name is not in it. */
export declare function handoverFileName(now: Date): string;
/** `nmts-public-code-<public code>.nmtscode`. The code is public, and it tells two such files apart. */
export declare function publicCodeFileName(code: string): string;
/** The handover file's text. Pretty-printed: somebody may well open it to see what it is. */
export declare function encodeHandover(file: HandoverFile): string;
/**
 * Read a handover file's text, in the order §5.6 gives: size, JSON, format, version, network, key
 * set, `note`, fields. `network` is the reader's own. Throws `HandoverFormatError`; never returns a
 * partial file.
 */
export declare function decodeHandover(text: string, network: HandoverNetwork): HandoverFile;
/** The name document, exactly as it is sealed. */
export declare function encodeHandoverName(doc: HandoverName): string;
/** Whether a name document, once sealed, fits the `name` field. The caller checks before sealing. */
export declare function handoverNameFits(encoded: string): boolean;
/** Read an opened name document. Throws `HandoverFormatError` (`bad-field`, `name`). */
export declare function decodeHandoverName(text: string): HandoverName;
/** The parts document, exactly as it is sealed. Compact: nobody reads it but the recipient's engine. */
export declare function encodePartsList(parts: readonly HandoverPart[]): string;
/** Read an opened parts document. Throws `HandoverFormatError` (`bad-field`, `parts`). */
export declare function decodePartsList(text: string): HandoverPart[];
/**
 * The smallest recorded end epoch, or 0 when any piece's is unknown (0). Exclusive, and recorded
 * when the file was made — see `HandoverPart.exp`.
 */
export declare function earliestExpiry(parts: readonly HandoverPart[]): number;
/** The public code file's text. */
export declare function encodePublicCodeFile(file: PublicCodeFile): string;
/**
 * Read a public code file's text. Throws `HandoverFormatError`.
 *
 * ⚠ This checks the SHAPE only. Whether `identity` really fingerprints to `code` is the engine's
 *   question, and a caller must ask it before sealing anything to the identity.
 */
export declare function decodePublicCodeFile(text: string): PublicCodeFile;
