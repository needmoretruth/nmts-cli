import { TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT, type AccountSettings } from "./manifest-settings.ts";
export { TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT };
export type { AccountSettings };
/**
 * One share this device made, kept where the server cannot reach it (`ManifestEntry.shares`).
 *
 * A receipt is written only AFTER the server's created row was checked to carry the very address
 * the sender typed — so what is stored is the address she asked for, never one the server chose.
 */
export interface ShareReceipt {
    /** Recipient address in WIRE form: exactly what the create call was checked against. */
    address: string;
    /** When this device wrote the receipt, ms since the Unix epoch. This browser's clock. */
    at: number;
    /**
     * A revoke was sent for this receipt and the listing has not yet come back without the row.
     *
     * The receipt outlives the revoke ON PURPOSE: a revoke this side cannot verify is exactly the
     * case worth keeping, and a listing that still carries the address is the only evidence the
     * removal did not happen. Dropped once a listing no longer names it (`sharePrune`), which is
     * what keeps this array from growing forever.
     */
    revoked?: true;
}
/** One entry — a file or a folder — as the rest of the app sees it. */
export interface ManifestEntry {
    /** Item id. Files: the id the server assigned at commit. Folders: client-generated. */
    id: string;
    /** Parent folder id, or null for the drive root. */
    parentId: string | null;
    /** 0 folder · 1 file (the same numeric codes the items API uses). */
    kind: number;
    /** Plaintext name. */
    name: string;
    /** Plaintext size in bytes; 0 for folders. */
    size: number;
    /** Created, ms since the Unix epoch (UTC). */
    createdAt: number;
    /** Last modified, ms since epoch. */
    updatedAt: number;
    /** In the trash since this instant; absent = live. */
    deletedAt?: number;
    /** Wrapped file DEK (base64url NCF-3 §3 envelope, 104 bytes), files only. Carried verbatim. */
    dekWrapped?: string;
    /** Sealed content hash (base64url NCF-3 §3 envelope, 104 bytes), files only. Carried verbatim. */
    contentHashCt?: string;
    /**
     * Which storage network holds this file's bytes (`lib/storage-network.ts` codes), files only.
     *
     * ABSENT MEANS WALRUS — a fact, not a default: no other network has an upload path, so every
     * entry written before this field is on Walrus by construction. Writing the field only when it
     * is NOT Walrus keeps the common case free, which matters in a blob that is rewritten whole on
     * every change and re-downloaded on every cold start.
     *
     * Here rather than read from the server per file because the drive list is built from THIS
     * document alone — the server's item rows carry no placement, and a per-file round trip to
     * learn where each one lives is what NMF-1 exists to avoid.
     *
     * ⚠ DISPLAY, NOT TRUTH. `file_parts.network` on the server is what recovery and the lifecycle
     * sweep read. A stale tab that saves can drop this mark the same way it can drop a star (see
     * MANIFEST_FORMAT_VERSION), which would show the wrong tier until the list is rebuilt — bad,
     * but not lost bytes.
     */
    network?: number;
    /** Starred by the person: shows in Favourites wherever the file actually lives. Absent = not. */
    favorite?: true;
    /** Kept at the top of its own folder listing. Absent = not. Independent of `favorite`. */
    pinned?: true;
    /**
     * MY OWN RECORD of who this file was shared with.
     *
     * WHY IT IS HERE. The recipients list on screen is the SERVER'S record: a row it joined through
     * `shares.recipient_id`. A server that hides a row makes the sender believe she never shared;
     * one that answers "deleted" without deleting makes her believe she took access back. Neither is
     * catchable from a list only the server can produce. This is the one place the server cannot
     * edit — the list is sealed under the account's own key — so a receipt written here is the only
     * thing that can be held up against what the server says.
     *
     * ⚠ WHAT IT DOES NOT DO. A receipt proves the SHARE WAS MADE; it cannot revoke one, and it
     * cannot make an adversarial server stop serving the ciphertext. It also cannot say a row with
     * no receipt is fabricated: shares made before this field existed have none, and a build that
     * does not read this field rewrites the list without it (the same limit every mark here has).
     * That asymmetry is why only two mismatches are ever shown to the person, and neither of them
     * is "the server invented a row" — see `share-receipts.ts`.
     *
     * Absent = this device has recorded nothing for this file, which is NOT "shared with nobody".
     */
    shares?: ShareReceipt[];
    /**
     * Labels — the person's own labels for this item, stored as the label TEXT.
     *
     * There is deliberately no registry of labels: a label exists exactly as long as some item wears
     * it. That is what keeps every edit replayable onto a list this device has not seen (two devices
     * inventing the same label converge instead of colliding on an id), and it means a label can
     * never outlive its last file as an empty row nobody can explain. Renaming one is a sweep across
     * the entries that carry it (manifest-ops.ts `labelRename`).
     *
     * The text is plaintext INSIDE the sealed blob — the same protection the file names get, and the
     * reason labels are not in the URL: a query string would hand the label to the server and the CDN
     * log in the clear — the server is never handed a per-account value it could use as a handle.
     */
    labels?: string[];
}
/**
 * Account-level settings that live INSIDE the sealed list.
 *
 * Here and not in a server column because the server must not learn them: which accounts run
 * developer mode, or read at what size, is exactly the sort of per-account profile it must never
 * be handed. Here and not in device storage because they are account-level — one switch, every
 * signed-in device.
 *
 * EVERY FIELD DEFAULTS BY ABSENCE, like the entry marks above it. ⚠ The honest limit is the same
 * as a star's: an older build that SAVES rewrites the blob without the member it never read, so a
 * stale tab can silently reset these. Turning them back on is the whole repair.
 */
/** The decoded manifest. */
export interface Manifest {
    /** Format version — NMF-1 is `1`. Read this FIRST when handling a future format. */
    v: number;
    /**
     * The store version this blob was SEALED at (NCF-3 §6.1, defect A3).
     *
     * The server also keeps this number in a column, and before NCF-3 that column was the only
     * copy — so the server could hand back an older `(seq, ct)` pair and the client had no way to
     * tell. Deleted files reappeared, recent uploads vanished, a rename undid itself. Sealing the
     * number means the version and the contents are authenticated together.
     */
    seq: number;
    /**
     * SHA-256 of the SEALED bytes this list was built from, base64url. Absent only for version 1.
     *
     * The version check alone narrows rollback; it does not close it. A server can pin a device that
     * is merely *behind* by answering with the version it last saw, and it can show two devices two
     * different forks indefinitely — "not lower than the highest I have seen" is satisfied by
     * standing still. A link to the previous blob makes a fork visible to the NEXT reader on ANY
     * device, because a list whose `prev` is not the blob that device actually opened cannot be a
     * continuation of it.
     */
    prev?: string;
    entries: ManifestEntry[];
    /** Account-level settings, absent when nothing was ever set. */
    settings?: AccountSettings;
}
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
export declare const MANIFEST_FORMAT_VERSION = 1;
/** base64url SHA-256 of a sealed blob — the value a later list carries as its `prev`. */
export declare function manifestFingerprint(ct: string): Promise<string>;
export declare const FLAG_RAW = 0;
export declare const FLAG_GZIP = 1;
/** The compact per-entry shape actually stored. */
export interface WireEntry {
    i: string;
    p: string | null;
    k: number;
    n: string;
    s: number;
    c: number;
    u: number;
    d?: number;
    w?: string;
    h?: string;
    f?: 1;
    pn?: 1;
    l?: string[];
    sn?: number;
    sh?: WireShareReceipt[];
}
/** One share receipt on the wire. Same short-key reason as the entry above it. */
interface WireShareReceipt {
    /** address. */
    a: string;
    /** at. */
    t: number;
    /** revoked. */
    r?: 1;
}
export declare function toWire(e: ManifestEntry): WireEntry;
export declare function fromWire(w: WireEntry): ManifestEntry;
/** Thrown when the plaintext is not a manifest this build can read. */
export declare class ManifestFormatError extends Error {
    constructor(message: string);
}
/**
 * Entries → the plaintext to seal.
 *
 * Compresses when the platform offers `CompressionStream`, which is the normal case and roughly
 * halves the blob (names and repeated JSON keys compress well). When it does not, the raw form is
 * written instead of failing: an older browser must still be able to save its drive.
 */
export declare function encodeManifest(entries: readonly ManifestEntry[], seq: number, prev?: string, settings?: AccountSettings): Promise<Uint8Array>;
/**
 * Sealed plaintext → entries.
 *
 * Throws `ManifestFormatError` on anything it cannot read — including a version from the future.
 * Callers must NOT treat a throw as "the drive is empty": it is the signal to try the retained
 * previous version, because rendering an empty drive invites the user to re-upload everything.
 */
export declare function decodeManifest(body: Uint8Array): Promise<Manifest>;
/** Prepend the compression flag byte. */
export declare function withFlag(flag: number, body: Uint8Array): Uint8Array;
/** gzip, or null when the platform has no `CompressionStream`. */
export declare function gzip(bytes: Uint8Array): Promise<Uint8Array | null>;
/** gunzip, or null when the platform has no `DecompressionStream`. */
export declare function gunzip(bytes: Uint8Array): Promise<Uint8Array | null>;
