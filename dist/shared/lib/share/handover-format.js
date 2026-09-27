// The two files a person can pass around outside NMTS: the HANDOVER file, which carries one file
// sealed to one recipient, and the PUBLIC CODE file, which lets a sender seal to somebody without
// asking the server for their identity. The byte layouts are fixed by the format specification
// (NCF-3 §5.6 and §5.7); this module is the JSON around them, and nothing else.
//
// ⛔ NO CRYPTOGRAPHY HERE, AND NO IMPORTS. Everything that needs a key or a hash happens in the
//    caller — the browser's crypto worker, or the command-line tool's engine. This module only
//    builds and reads the text, so both programs refuse the same files for the same reasons. It is
//    copied byte for byte into the command-line package.
//
// ⛔ IT REFUSES EXACTLY WHAT §5.6 AND §5.7 SAY A READER REFUSES, and nothing else. The specification
//    lists every refusal (the size cap, the closed key sets, the `note` shape, the version rule, the
//    network, the lengths, canonical base64url); a refusal added here and not there makes two
//    readers of one published format disagree about one file.
//
// ⚠ THE ITEM ID IS COMPARED AS WRITTEN. §5.3 lowercases it before binding, so "ABC" and "abc" bind
//   the same. A reader that accepted "ABC" would show text different from what was bound, so an item
//   id that is not already lowercase is refused here.
/** Wire values of the handover file. Fixed forever once a file carries them. */
export const HANDOVER_FORMAT = "nmts-handover";
export const HANDOVER_VERSION = 1;
/** Marker inside the sealed parts document. */
export const HANDOVER_PARTS_FORMAT = "nmts-handover-parts/1";
/** Marker of the name document — the §5.4 share document, which a handover extends by two keys. */
export const SHARE_FILE_FORMAT = "nmts-share-file/1";
/** Wire values of the public code file. */
export const PUBLIC_CODE_FORMAT = "nmts-public-code";
export const PUBLIC_CODE_VERSION = 1;
/** File name endings. */
export const HANDOVER_EXTENSION = ".nmtshandover";
export const PUBLIC_CODE_EXTENSION = ".nmtscode";
/**
 * What a person who opens the file in a text editor reads. Informational; not read back.
 * The two place names are the labels on the screen: the side panel entry and the button.
 */
export const HANDOVER_NOTE = [
    "An NMTS handover file. Sign in at nmts.me with the NMTS key it was made for, then open it from Shared with me → Open handover file.",
    "NMTS 건네기 파일입니다. 이 파일을 받을 NMTS 키로 nmts.me에 로그인한 뒤 「받은 공유함」 → 「건네기 파일 열기」에서 여십시오.", // shown in Korean
];
/** Size caps on the whole text, checked before it is parsed (§5.6, §5.7). */
export const MAX_HANDOVER_FILE_BYTES = 1024 * 1024;
export const MAX_PUBLIC_CODE_FILE_BYTES = 8 * 1024;
/** Exact byte lengths the specification fixes. */
const IDENTITY_LEN = 4989;
const ENVELOPE_LEN = 1240;
const DIGEST_ENVELOPE_LEN = 104;
const SHA256_LEN = 32;
/** nonce(24) + commitment(32) + tag(16): the smallest sealed value, with an empty plaintext. */
const MIN_SEALED_LEN = 72;
/** Field bounds (§5.6). Together they keep a file under MAX_HANDOVER_FILE_BYTES. */
export const MAX_NAME_SEALED_LEN = 64 * 1024;
const MAX_PARTS_SEALED_LEN = 640 * 1024;
const MAX_PARTS = 4096;
const MAX_EPOCH = 0xffff_ffff;
const MAX_CODE_CHARS = 64;
const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL = /^[A-Za-z0-9_-]*$/;
/** Blob and patch ids go into an aggregator URL, so they are held to the base64url alphabet. */
const STORAGE_ID = /^[A-Za-z0-9_-]{1,256}$/;
export class HandoverFormatError extends Error {
    problem;
    /** The field at fault, for `bad-field`. */
    field;
    constructor(problem, field = null) {
        super(field === null ? `handover file: ${problem}` : `handover file: ${problem} (${field})`);
        this.name = "HandoverFormatError";
        this.problem = problem;
        this.field = field;
    }
}
/**
 * Bytes behind an unpadded base64url string, or null when it is not one in CANONICAL form: the
 * bits the last character carries beyond the data must be zero, so one byte string has one text.
 */
export function base64UrlByteLength(text) {
    if (!B64URL.test(text))
        return null;
    const rest = text.length % 4;
    if (rest === 1)
        return null;
    if (rest !== 0) {
        const last = B64URL_ALPHABET.indexOf(text.charAt(text.length - 1));
        const unused = rest === 2 ? 0b1111 : 0b11;
        if ((last & unused) !== 0)
            return null;
    }
    return Math.floor(text.length / 4) * 3 + (rest === 0 ? 0 : rest - 1);
}
/** `nmts-handover-<YYYY-MM-DD>.nmtshandover`, the date in UTC. The file's own name is not in it. */
export function handoverFileName(now) {
    return `nmts-handover-${now.toISOString().slice(0, 10)}${HANDOVER_EXTENSION}`;
}
/** `nmts-public-code-<public code>.nmtscode`. The code is public, and it tells two such files apart. */
export function publicCodeFileName(code) {
    return `nmts-public-code-${code.replace(/[^0-9A-Za-z-]/g, "")}${PUBLIC_CODE_EXTENSION}`;
}
/** The handover file's text. Pretty-printed: somebody may well open it to see what it is. */
export function encodeHandover(file) {
    checkHandover(file);
    const { network, item, sender, envelope, name, hash, parts } = file;
    const doc = { format: HANDOVER_FORMAT, version: HANDOVER_VERSION, network, item, sender, envelope, name, hash, parts, note: HANDOVER_NOTE };
    return `${JSON.stringify(doc, null, 2)}\n`;
}
/**
 * Read a handover file's text, in the order §5.6 gives: size, JSON, format, version, network, key
 * set, `note`, fields. `network` is the reader's own. Throws `HandoverFormatError`; never returns a
 * partial file.
 */
export function decodeHandover(text, network) {
    capBytes(text, MAX_HANDOVER_FILE_BYTES);
    const doc = objectOf(text);
    if (doc["format"] !== HANDOVER_FORMAT)
        throw new HandoverFormatError("wrong-format");
    checkVersion(doc["version"], HANDOVER_VERSION);
    const fileNetwork = doc["network"];
    if (fileNetwork !== "mainnet" && fileNetwork !== "testnet")
        throw new HandoverFormatError("bad-field", "network");
    if (fileNetwork !== network)
        throw new HandoverFormatError("other-network");
    closedKeys(doc, ["format", "version", "network", "item", "sender", "envelope", "name", "hash", "parts", "note"]);
    const note = doc["note"];
    if (note !== undefined && !(Array.isArray(note) && note.every((line) => typeof line === "string"))) {
        throw new HandoverFormatError("bad-field", "note");
    }
    const file = {
        network: fileNetwork,
        item: stringField(doc, "item"),
        sender: stringField(doc, "sender"),
        envelope: stringField(doc, "envelope"),
        name: stringField(doc, "name"),
        hash: stringField(doc, "hash"),
        parts: stringField(doc, "parts"),
    };
    checkHandover(file);
    return file;
}
/** The name document, exactly as it is sealed. */
export function encodeHandoverName(doc) {
    checkName(doc);
    return JSON.stringify({ f: SHARE_FILE_FORMAT, name: doc.name, size: doc.size, network: doc.network, parts_sha256: doc.partsSha256 });
}
/** Whether a name document, once sealed, fits the `name` field. The caller checks before sealing. */
export function handoverNameFits(encoded) {
    return new TextEncoder().encode(encoded).length + MIN_SEALED_LEN <= MAX_NAME_SEALED_LEN;
}
/** Read an opened name document. Throws `HandoverFormatError` (`bad-field`, `name`). */
export function decodeHandoverName(text) {
    const doc = objectOf(text);
    const bad = new HandoverFormatError("bad-field", "name");
    const keys = Object.keys(doc).sort().join(",");
    if (keys !== "f,name,network,parts_sha256,size" || doc["f"] !== SHARE_FILE_FORMAT)
        throw bad;
    const name = doc["name"];
    const size = doc["size"];
    const network = doc["network"];
    const partsSha256 = doc["parts_sha256"];
    if (typeof name !== "string" || typeof size !== "number" || typeof partsSha256 !== "string")
        throw bad;
    if (network !== "mainnet" && network !== "testnet")
        throw bad;
    const out = { name, size, network, partsSha256 };
    checkName(out);
    return out;
}
/** The parts document, exactly as it is sealed. Compact: nobody reads it but the recipient's engine. */
export function encodePartsList(parts) {
    checkParts(parts);
    return JSON.stringify({
        f: HANDOVER_PARTS_FORMAT,
        parts: parts.map((p, i) => ({ i, blob: p.blob, patch: p.patch, len: p.len, exp: p.exp })),
    });
}
/** Read an opened parts document. Throws `HandoverFormatError` (`bad-field`, `parts`). */
export function decodePartsList(text) {
    const doc = objectOf(text);
    const bad = new HandoverFormatError("bad-field", "parts");
    if (Object.keys(doc).sort().join(",") !== "f,parts" || doc["f"] !== HANDOVER_PARTS_FORMAT)
        throw bad;
    const raw = doc["parts"];
    if (!Array.isArray(raw))
        throw bad;
    const parts = raw.map((value, index) => {
        if (!isRecord(value))
            throw bad;
        const keys = Object.keys(value).sort().join(",");
        if (keys !== "blob,exp,i,len,patch" || value["i"] !== index)
            throw bad;
        const blob = value["blob"];
        const patch = value["patch"];
        const len = value["len"];
        const exp = value["exp"];
        if ((blob !== null && typeof blob !== "string") || (patch !== null && typeof patch !== "string"))
            throw bad;
        if (typeof len !== "number" || typeof exp !== "number")
            throw bad;
        return { blob, patch, len, exp };
    });
    checkParts(parts);
    return parts;
}
/**
 * The smallest recorded end epoch, or 0 when any piece's is unknown (0). Exclusive, and recorded
 * when the file was made — see `HandoverPart.exp`.
 */
export function earliestExpiry(parts) {
    if (parts.some((p) => p.exp === 0))
        return 0;
    return parts.reduce((min, p) => Math.min(min, p.exp), MAX_EPOCH);
}
/** The public code file's text. */
export function encodePublicCodeFile(file) {
    checkPublicCode(file);
    const doc = { format: PUBLIC_CODE_FORMAT, version: PUBLIC_CODE_VERSION, code: file.code, identity: file.identity };
    return `${JSON.stringify(doc, null, 2)}\n`;
}
/**
 * Read a public code file's text. Throws `HandoverFormatError`.
 *
 * ⚠ This checks the SHAPE only. Whether `identity` really fingerprints to `code` is the engine's
 *   question, and a caller must ask it before sealing anything to the identity.
 */
export function decodePublicCodeFile(text) {
    capBytes(text, MAX_PUBLIC_CODE_FILE_BYTES);
    const doc = objectOf(text);
    if (doc["format"] !== PUBLIC_CODE_FORMAT)
        throw new HandoverFormatError("wrong-format");
    checkVersion(doc["version"], PUBLIC_CODE_VERSION);
    closedKeys(doc, ["format", "version", "code", "identity"]);
    const file = { code: stringField(doc, "code"), identity: stringField(doc, "identity") };
    checkPublicCode(file);
    return file;
}
// ── checks ───────────────────────────────────────────────────────────────────────────────────
function capBytes(text, max) {
    // UTF-16 units never outnumber UTF-8 bytes, so a long string is refused before it is encoded.
    if (text.length > max || new TextEncoder().encode(text).length > max) {
        throw new HandoverFormatError("too-large");
    }
}
/** An integer above the known version is "newer"; anything else that is not the version is wrong. */
function checkVersion(version, known) {
    if (version === known)
        return;
    if (typeof version === "number" && Number.isSafeInteger(version) && version > known) {
        throw new HandoverFormatError("unknown-version");
    }
    throw new HandoverFormatError("bad-field", "version");
}
function closedKeys(doc, allowed) {
    for (const key of Object.keys(doc)) {
        if (!allowed.includes(key))
            throw new HandoverFormatError("bad-field", key);
    }
}
function checkHandover(file) {
    if (file.network !== "mainnet" && file.network !== "testnet")
        throw new HandoverFormatError("bad-field", "network");
    if (!UUID_LOWER.test(file.item))
        throw new HandoverFormatError("bad-field", "item");
    exactly(file.sender, IDENTITY_LEN, "sender");
    exactly(file.envelope, ENVELOPE_LEN, "envelope");
    exactly(file.hash, DIGEST_ENVELOPE_LEN, "hash");
    within(file.name, MIN_SEALED_LEN + 1, MAX_NAME_SEALED_LEN, "name");
    within(file.parts, MIN_SEALED_LEN + 1, MAX_PARTS_SEALED_LEN, "parts");
}
function checkName(doc) {
    const network = doc.network === "mainnet" || doc.network === "testnet";
    const ok = Number.isSafeInteger(doc.size) && doc.size >= 0 && network && base64UrlByteLength(doc.partsSha256) === SHA256_LEN;
    if (!ok)
        throw new HandoverFormatError("bad-field", "name");
}
function checkParts(parts) {
    if (parts.length === 0 || parts.length > MAX_PARTS)
        throw new HandoverFormatError("bad-field", "parts");
    for (const p of parts) {
        const ok = (p.blob === null) !== (p.patch === null) &&
            (p.blob === null || STORAGE_ID.test(p.blob)) &&
            (p.patch === null || STORAGE_ID.test(p.patch)) &&
            Number.isSafeInteger(p.len) &&
            p.len > 0 &&
            Number.isSafeInteger(p.exp) &&
            p.exp >= 0 &&
            p.exp <= MAX_EPOCH;
        if (!ok)
            throw new HandoverFormatError("bad-field", "parts");
    }
}
function checkPublicCode(file) {
    if (file.code.length === 0 || file.code.length > MAX_CODE_CHARS)
        throw new HandoverFormatError("bad-field", "code");
    exactly(file.identity, IDENTITY_LEN, "identity");
}
function exactly(value, bytes, field) {
    if (base64UrlByteLength(value) !== bytes)
        throw new HandoverFormatError("bad-field", field);
}
function within(value, min, max, field) {
    const n = base64UrlByteLength(value);
    if (n === null || n < min || n > max)
        throw new HandoverFormatError("bad-field", field);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function objectOf(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new HandoverFormatError("not-json");
    }
    if (!isRecord(parsed))
        throw new HandoverFormatError("not-json");
    return parsed;
}
function stringField(doc, field) {
    const value = doc[field];
    if (typeof value !== "string")
        throw new HandoverFormatError("bad-field", field);
    return value;
}
