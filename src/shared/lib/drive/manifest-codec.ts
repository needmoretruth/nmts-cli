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
import { NETWORK_WHEN_UNRECORDED } from "../storage-network.ts";

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
export interface AccountSettings {
  /** Developer mode — technical storage facts + ciphertext links in the file detail. Absent = off. */
  developerMode?: true;
  /**
   * In-app text size, percent of the DEVICE's own size. Absent = 100 = follow the device. Never a
   * pixel value: the device's own accessibility setting stays underneath, and this multiplies it.
   */
  textScalePct?: number;
  /**
   * SIZE PADDING rule — how coarsely a file's stored size is rounded up.
   *
   * Absent = Padmé, the default: about 32 possible sizes per doubling, ~1% more storage.
   * `"pow2"` rounds to the next power of two: one size per doubling, ~39% more storage. Those are
   * the only two, and there is deliberately no "off" — the owner's choice was between two rules,
   * and switching padding off would mean "this account's files still state their exact size".
   *
   * Here, in the sealed list, for the same reason the other two are: the server must not learn it
   * (it would be a per-account fingerprint the server could hold on to), and it
   * follows the account rather than the device, so a phone and a laptop pad the same way.
   *
   * ⚠ It applies to what is uploaded NEXT. Bytes already on the storage network cannot be
   * re-padded, and the screen says so.
   */
  paddingMode?: "pow2";
}

/** The sanity bounds a stored text scale must sit in to be USED. One place; codec and UI agree. */
export const TEXT_SCALE_MIN_PCT = 80;
export const TEXT_SCALE_MAX_PCT = 160;
/** Follow the device. Not written to the wire — absence is the only spelling of it. */
export const TEXT_SCALE_DEFAULT_PCT = 100;

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
export const MANIFEST_FORMAT_VERSION = 1;

/** base64url SHA-256 of a sealed blob — the value a later list carries as its `prev`. */
export async function manifestFingerprint(ct: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ct));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const FLAG_RAW = 0x00;
const FLAG_GZIP = 0x01;

/** The compact per-entry shape actually stored. */
interface WireEntry {
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

/** Account settings on the wire — short keys for the same reason the entries use them. */
interface WireSettings {
  /** developerMode. */
  dm?: 1;
  /** textScalePct. */
  tx?: number;
}

interface WireManifest {
  v: number;
  /** The store version this blob is sealed at — NCF-3 §6.1. */
  seq: number;
  /** base64url SHA-256 of the sealed blob this one was built from; absent at version 1. */
  p?: string;
  items: WireEntry[];
  /** Account-level settings; absent when everything is at its default. */
  st?: WireSettings;
}

/** Settings → wire, or null when every field is at its default (then nothing is written). */
function settingsToWire(s: AccountSettings | undefined): WireSettings | null {
  if (!s) return null;
  const w: WireSettings = {};
  if (s.developerMode) w.dm = 1;
  if (
    typeof s.textScalePct === "number" &&
    Number.isFinite(s.textScalePct) &&
    s.textScalePct !== TEXT_SCALE_DEFAULT_PCT &&
    s.textScalePct >= TEXT_SCALE_MIN_PCT &&
    s.textScalePct <= TEXT_SCALE_MAX_PCT
  ) {
    w.tx = Math.round(s.textScalePct);
  }
  return w.dm !== undefined || w.tx !== undefined ? w : null;
}

/**
 * Wire → settings, dropping anything unusable. A text scale outside the bounds is DROPPED, not
 * clamped: rendering a whole app at a number some other build miswrote is worse than falling back
 * to the device's own size, which is always readable.
 */
function settingsFromWire(w: unknown): AccountSettings | undefined {
  if (!w || typeof w !== "object") return undefined;
  const raw = w as WireSettings;
  const s: AccountSettings = {};
  if (raw.dm === 1) s.developerMode = true;
  if (
    typeof raw.tx === "number" &&
    Number.isFinite(raw.tx) &&
    raw.tx !== TEXT_SCALE_DEFAULT_PCT &&
    raw.tx >= TEXT_SCALE_MIN_PCT &&
    raw.tx <= TEXT_SCALE_MAX_PCT
  ) {
    s.textScalePct = Math.round(raw.tx);
  }
  return s.developerMode !== undefined || s.textScalePct !== undefined ? s : undefined;
}

function toWire(e: ManifestEntry): WireEntry {
  const w: WireEntry = {
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
  if (e.deletedAt !== undefined) w.d = e.deletedAt;
  if (e.dekWrapped !== undefined) w.w = e.dekWrapped;
  if (e.contentHashCt !== undefined) w.h = e.contentHashCt;
  // Marks are written only when set, and `labels` only when it holds something: an empty array
  // would cost bytes on every entry of every save to say exactly what its absence already says.
  if (e.favorite) w.f = 1;
  if (e.pinned) w.pn = 1;
  if (e.labels && e.labels.length > 0) w.l = e.labels;
  // Walrus is written as absence: it is what every entry that lacks the field already means, so
  // spelling it out would cost bytes on every file of every save to say nothing new.
  if (e.network !== undefined && e.network !== NETWORK_WHEN_UNRECORDED) w.sn = e.network;
  if (e.shares && e.shares.length > 0) {
    w.sh = e.shares.map((r) => (r.revoked ? { a: r.address, t: r.at, r: 1 } : { a: r.address, t: r.at }));
  }
  return w;
}

function fromWire(w: WireEntry): ManifestEntry {
  const e: ManifestEntry = {
    id: w.i,
    parentId: w.p ?? null,
    kind: w.k,
    name: w.n,
    size: w.s,
    createdAt: w.c,
    updatedAt: w.u,
  };
  if (w.d !== undefined) e.deletedAt = w.d;
  if (w.w !== undefined) e.dekWrapped = w.w;
  if (w.h !== undefined) e.contentHashCt = w.h;
  if (w.f === 1) e.favorite = true;
  if (w.pn === 1) e.pinned = true;
  // Defensive: another build (or a partially applied edit) could leave a non-array or blank
  // entries here. Labels drive a whole navigation surface, so anything unusable is dropped rather
  // than rendered as a label the person cannot select, rename or remove.
  if (Array.isArray(w.l)) {
    const clean = w.l.filter((s): s is string => typeof s === "string" && s.trim() !== "");
    if (clean.length > 0) e.labels = clean;
  }
  // Carried through even when this build does not recognise the code: dropping it would REWRITE
  // the entry without it on the next save, turning "stored somewhere I do not know" into
  // "stored on Walrus" — a claim about someone else's bytes that nothing would ever correct.
  if (typeof w.sn === "number") e.network = w.sn;
  // Defensive in the same way labels are, and for a sharper reason: a receipt with a blank address
  // or a broken instant would be compared against the server's rows and could produce a warning
  // about a share nobody ever made. Anything unusable is dropped — a receipt that cannot be
  // checked says nothing, and saying nothing is the honest outcome.
  if (Array.isArray(w.sh)) {
    const clean: ShareReceipt[] = [];
    for (const raw of w.sh) {
      if (!raw || typeof raw !== "object") continue;
      const { a, t, r } = raw;
      if (typeof a !== "string" || a === "") continue;
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      clean.push(r === 1 ? { address: a, at: t, revoked: true } : { address: a, at: t });
    }
    if (clean.length > 0) e.shares = clean;
  }
  return e;
}

/** Thrown when the plaintext is not a manifest this build can read. */
export class ManifestFormatError extends Error {
  constructor(message: string) {
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
export async function encodeManifest(
  entries: readonly ManifestEntry[],
  seq: number,
  prev?: string,
  settings?: AccountSettings,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new ManifestFormatError(`manifest seq must be a positive integer, got ${seq}`);
  }
  // Version 1 has nothing before it; every later version must name what it continued from, or the
  // fork check has a hole exactly where a fork would be introduced.
  if (seq > 1 && !prev) {
    throw new ManifestFormatError(`manifest seq ${seq} must name the version it was built on`);
  }
  const st = settingsToWire(settings);
  const wire: WireManifest = {
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
export async function decodeManifest(body: Uint8Array): Promise<Manifest> {
  if (body.length < 1) throw new ManifestFormatError("empty manifest body");
  const flag = body[0];
  const rest = body.subarray(1);

  let json: Uint8Array;
  if (flag === FLAG_RAW) {
    json = rest;
  } else if (flag === FLAG_GZIP) {
    const out = await gunzip(rest);
    if (!out) throw new ManifestFormatError("manifest is gzipped but this platform cannot expand it");
    json = out;
  } else {
    throw new ManifestFormatError(`unknown manifest compression flag ${flag}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new ManifestFormatError("manifest body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ManifestFormatError("manifest body is not an object");
  }
  const doc = parsed as Partial<WireManifest>;
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
  if (!Number.isSafeInteger(doc.seq) || (doc.seq as number) < 1) {
    throw new ManifestFormatError(`manifest has no sealed version (seq=${String(doc.seq)})`);
  }
  const seq = doc.seq as number;
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
function withFlag(flag: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = flag;
  out.set(body, 1);
  return out;
}

/** gzip, or null when the platform has no `CompressionStream`. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const C = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!C) return null;
  return collect(streamThrough(bytes, new C("gzip")));
}

/** gunzip, or null when the platform has no `DecompressionStream`. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const D = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!D) return null;
  return collect(streamThrough(bytes, new D("gzip")));
}

function streamThrough(
  bytes: Uint8Array,
  // `CompressionStream`'s writable side is typed `BufferSource`, its readable side `Uint8Array`.
  // The pair is spelled out here rather than constrained to one element type so both directions
  // type-check without an `as` on the transform itself.
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
): ReadableStream<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
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

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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
