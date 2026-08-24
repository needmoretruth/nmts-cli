// NMF-1 — the on-the-wire form of the sealed file list (CRYPTO-FORMAT-NCF3.md §6). ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// This module is ONLY the byte format: entries ⇄ the plaintext that gets sealed. It performs no
// I/O, holds no key and never touches the network, so it is unit-testable without a browser and
// is the single place the format is written down in TypeScript.
//
// SHAPE: `flag(1) || json` where flag 0x00 = raw UTF-8 JSON and 0x01 = gzip of it. The flag lives
//   INSIDE the sealed plaintext: beside it, it would be an unauthenticated input an attacker
//   could flip, and the server would be able to see which form was used.
//
// FIELD NAMES ARE ONE OR TWO LETTERS on purpose. This blob is rewritten in full on every change
//   and downloaded on every cold start, so the key strings are a real fraction of its size — at
//   ~10k entries, spelling them out costs hundreds of kilobytes per save on someone's phone.
//   Readability lives in ManifestEntry below, which is what the rest of the app actually uses.
// Relative, with the extension, because `node --test` type-strips this module directly for the
// codec round-trip suite and resolves no path aliases.
import { NETWORK_WHEN_UNRECORDED } from "../storage-network.js";
import { settingsFromWire, settingsToWire, TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT, } from "./manifest-settings.js";
export { TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT };
/**
 * Current format version this build writes.
 *
 * STAYS 1 WHEN OPTIONAL FIELDS ARE ADDED (favorite · pinned · labels · account settings landed
 * this way). The reader
 * below refuses any version it does not know, so bumping would lock every already-open tab out of
 * the drive to buy nothing: an older build ignores fields it has never heard of and renders the
 * list correctly. The cost of that choice is real and bounded — an older build that SAVES rewrites
  * the entries without the marks it dropped, so a stale tab can clear stars and labels. Bump only for
 * a change an old build would MISREAD, not one it would merely not show.
 */
export const MANIFEST_FORMAT_VERSION = 1;
/** base64url SHA-256 of a sealed blob — the value a later list carries as its `prev`. */
export async function manifestFingerprint(ct) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ct));
    let bin = "";
    for (const b of new Uint8Array(digest))
        bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const FLAG_RAW = 0x00;
const FLAG_GZIP = 0x01;
function toWire(e) {
    const w = {
        i: e.id,
        p: e.parentId,
        k: e.kind,
        n: e.name,
        s: e.size,
        c: e.createdAt,
        u: e.updatedAt,
    };
    // Optional fields are OMITTED rather than written as null: "absent" and "present but empty"
    // must stay distinguishable, and omitting is also the cheaper encoding.
    if (e.deletedAt !== undefined)
        w.d = e.deletedAt;
    if (e.dekWrapped !== undefined)
        w.w = e.dekWrapped;
    if (e.contentHashCt !== undefined)
        w.h = e.contentHashCt;
    // Marks are written only when set, and `labels` only when it holds something: an empty array
    // would cost bytes on every entry of every save to say exactly what its absence already says.
    if (e.favorite)
        w.f = 1;
    if (e.pinned)
        w.pn = 1;
    if (e.labels && e.labels.length > 0)
        w.l = e.labels;
    // Walrus is written as absence: it is what every entry that lacks the field already means, so
    // spelling it out would cost bytes on every file of every save to say nothing new.
    if (e.network !== undefined && e.network !== NETWORK_WHEN_UNRECORDED)
        w.sn = e.network;
    if (e.shares && e.shares.length > 0) {
        w.sh = e.shares.map((r) => (r.revoked ? { a: r.address, t: r.at, r: 1 } : { a: r.address, t: r.at }));
    }
    return w;
}
function fromWire(w) {
    const e = {
        id: w.i,
        parentId: w.p ?? null,
        kind: w.k,
        name: w.n,
        size: w.s,
        createdAt: w.c,
        updatedAt: w.u,
    };
    if (w.d !== undefined)
        e.deletedAt = w.d;
    if (w.w !== undefined)
        e.dekWrapped = w.w;
    if (w.h !== undefined)
        e.contentHashCt = w.h;
    if (w.f === 1)
        e.favorite = true;
    if (w.pn === 1)
        e.pinned = true;
    // Defensive: another build (or a partially applied edit) could leave a non-array or blank
    // entries here. Labels drive a whole navigation surface, so anything unusable is dropped rather
    // than rendered as a label the person cannot select, rename or remove.
    if (Array.isArray(w.l)) {
        const clean = w.l.filter((s) => typeof s === "string" && s.trim() !== "");
        if (clean.length > 0)
            e.labels = clean;
    }
    // Carried through even when this build does not recognise the code: dropping it would REWRITE
    // the entry without it on the next save, turning "stored somewhere I do not know" into
    // "stored on Walrus" — a claim about someone else's bytes that nothing would ever correct.
    if (typeof w.sn === "number")
        e.network = w.sn;
    // Defensive in the same way labels are, and for a sharper reason: a receipt with a blank address
    // or a broken instant would be compared against the server's rows and could produce a warning
    // about a share nobody ever made. Anything unusable is dropped — a receipt that cannot be
    // checked says nothing, and saying nothing is the honest outcome.
    if (Array.isArray(w.sh)) {
        const clean = [];
        for (const raw of w.sh) {
            if (!raw || typeof raw !== "object")
                continue;
            const { a, t, r } = raw;
            if (typeof a !== "string" || a === "")
                continue;
            if (typeof t !== "number" || !Number.isFinite(t))
                continue;
            clean.push(r === 1 ? { address: a, at: t, revoked: true } : { address: a, at: t });
        }
        if (clean.length > 0)
            e.shares = clean;
    }
    return e;
}
/** Thrown when the plaintext is not a manifest this build can read. */
export class ManifestFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ManifestFormatError";
    }
}
/**
 * Entries → the plaintext to seal.
 *
 * Compresses when the platform offers `CompressionStream`, which is the normal case and roughly
 * halves the blob (names and repeated JSON keys compress well). When it does not, the raw form is
 * written instead of failing: an older browser must still be able to save its drive.
 */
export async function encodeManifest(entries, seq, prev, settings) {
    if (!Number.isSafeInteger(seq) || seq < 1) {
        throw new ManifestFormatError(`manifest seq must be a positive integer, got ${seq}`);
    }
    // Version 1 has nothing before it; every later version must name what it continued from, or the
    // fork check has a hole exactly where a fork would be introduced.
    if (seq > 1 && !prev) {
        throw new ManifestFormatError(`manifest seq ${seq} must name the version it was built on`);
    }
    const st = settingsToWire(settings);
    const wire = {
        v: MANIFEST_FORMAT_VERSION,
        seq,
        ...(prev ? { p: prev } : {}),
        items: entries.map(toWire),
        ...(st ? { st } : {}),
    };
    const json = new TextEncoder().encode(JSON.stringify(wire));
    const gz = await gzip(json);
    return gz ? withFlag(FLAG_GZIP, gz) : withFlag(FLAG_RAW, json);
}
/**
 * Sealed plaintext → entries.
 *
 * Throws `ManifestFormatError` on anything it cannot read — including a version from the future.
 * Callers must NOT treat a throw as "the drive is empty": it is the signal to try the retained
 * previous version, because rendering an empty drive invites the user to re-upload everything.
 */
export async function decodeManifest(body) {
    if (body.length < 1)
        throw new ManifestFormatError("empty manifest body");
    const flag = body[0];
    const rest = body.subarray(1);
    let json;
    if (flag === FLAG_RAW) {
        json = rest;
    }
    else if (flag === FLAG_GZIP) {
        const out = await gunzip(rest);
        if (!out)
            throw new ManifestFormatError("manifest is gzipped but this platform cannot expand it");
        json = out;
    }
    else {
        throw new ManifestFormatError(`unknown manifest compression flag ${flag}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
    }
    catch {
        throw new ManifestFormatError("manifest body is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new ManifestFormatError("manifest body is not an object");
    }
    const doc = parsed;
    if (doc.v !== MANIFEST_FORMAT_VERSION) {
        // A newer version means another device wrote a format this build predates. Refusing is the
        // safe answer: guessing at unknown fields and then SAVING would drop whatever it did not
        // understand, silently destroying entries the other device could still read.
        throw new ManifestFormatError(`unsupported manifest version ${String(doc.v)}`);
    }
    if (!Array.isArray(doc.items)) {
        throw new ManifestFormatError("manifest has no item list");
    }
    // The sealed version is required. Treating a missing one as "0" or "unknown" would reopen
    // exactly the hole this field closes: the server could strip its way back to an unchecked read.
    if (!Number.isSafeInteger(doc.seq) || doc.seq < 1) {
        throw new ManifestFormatError(`manifest has no sealed version (seq=${String(doc.seq)})`);
    }
    const seq = doc.seq;
    if (seq > 1 && typeof doc.p !== "string") {
        throw new ManifestFormatError(`manifest ${seq} does not say what it was built on`);
    }
    const settings = settingsFromWire(doc.st);
    return {
        v: doc.v,
        seq,
        ...(typeof doc.p === "string" ? { prev: doc.p } : {}),
        entries: doc.items.map(fromWire),
        ...(settings ? { settings } : {}),
    };
}
/** Prepend the compression flag byte. */
function withFlag(flag, body) {
    const out = new Uint8Array(body.length + 1);
    out[0] = flag;
    out.set(body, 1);
    return out;
}
/** gzip, or null when the platform has no `CompressionStream`. */
async function gzip(bytes) {
    const C = globalThis.CompressionStream;
    if (!C)
        return null;
    return collect(streamThrough(bytes, new C("gzip")));
}
/** gunzip, or null when the platform has no `DecompressionStream`. */
async function gunzip(bytes) {
    const D = globalThis.DecompressionStream;
    if (!D)
        return null;
    return collect(streamThrough(bytes, new D("gzip")));
}
function streamThrough(bytes, 
// `CompressionStream`'s writable side is typed `BufferSource`, its readable side `Uint8Array`.
// The pair is spelled out here rather than constrained to one element type so both directions
// type-check without an `as` on the transform itself.
transform) {
    const source = new ReadableStream({
        start(controller) {
            // Copied into a view over a plain ArrayBuffer: a `Uint8Array` may sit on a
            // SharedArrayBuffer, which the stream's `BufferSource` input does not accept. One copy of
            // an already-serialised list is negligible next to the compression pass that follows.
            const owned = new Uint8Array(new ArrayBuffer(bytes.length));
            owned.set(bytes);
            controller.enqueue(owned);
            controller.close();
        },
    });
    return source.pipeThrough(transform);
}
async function collect(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.length;
    }
    return out;
}
