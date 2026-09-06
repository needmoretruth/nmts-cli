// The CHUNKED file list — NCF-3 §6.3, format version 2.
// ⚠ PUBLISHED — copied byte-for-byte into the `nmts` command-line package; keep comments
// self-contained English.
//
// The index stays where the single sealed list was; the entries move into immutable chunks of at
// most 4 MiB sealed bytes, each named by the hash of its transport string, so an edit rewrites one
// chunk and the index instead of the whole list. This module is ONLY the byte format — entries ⇄
// the plaintext that gets sealed, for both halves. It performs no I/O, holds no key and never
// touches the network, exactly like `manifest-codec.ts` beside it, and for the same reason: the
// format has to be unit-testable without a browser and written down in one place.
//
// WHY TWO LABELS. The index and a chunk are the same shape of bytes to the server, so a chunk
//   handed back where an index was asked for has to fail at the AEAD rather than at the parser.
//   That is what `AAD_FILE_LIST_CHUNK` buys, and it is the whole reason the constant exists.
//
// WHAT THE INDEX PINS. The index is authenticated (envelope), continued (`p`), and it names every
//   chunk by hash. A server that swaps, drops, duplicates or rolls a chunk back produces bytes
//   whose hash is not the one the index named. So every check §6.1 makes on the one blob now
//   covers the whole list — see `manifest-chunk-flow.ts`, which is where the checking happens.
import {
  decodeManifest,
  FLAG_GZIP,
  FLAG_RAW,
  fromWire,
  gunzip,
  gzip,
  manifestFingerprint,
  ManifestFormatError,
  toWire,
  withFlag,
  type AccountSettings,
  type Manifest,
  type ManifestEntry,
  type WireEntry,
} from "./manifest-codec.ts";
import { settingsFromWire, settingsToWire, type WireSettings } from "./manifest-settings.ts";
import { zstdCodec, zstdContentSize, ZSTD_LEVEL } from "./zstd.ts";

/**
 * Envelope AAD for ONE CHUNK of the chunked file list (NCF-3 §2, §6.3). Its own label, distinct
 * from `AAD_FILE_LIST`, so a chunk can never be presented as an index or an index as a chunk —
 * the server holds both as opaque bytes of the same shape.
 */
export const AAD_FILE_LIST_CHUNK = "nmts/v3/file-list-chunk";

/** The version an index and its chunks carry. Version 1 is the single blob `manifest-codec` reads. */
export const FILE_LIST_VERSION_CHUNKED = 2;

/** Compression flag 0x02 — zstd (NCF-3 §6.3.4). 0x00 and 0x01 are `manifest-codec`'s. */
export const FLAG_ZSTD = 0x02;

/**
 * The plaintext bound for ONE CHUNK (NCF-3 §6.3.3).
 *
 * On the PLAINTEXT and not on the sealed size, so a writer can decide where to close a chunk
 * before it compresses or seals anything: 3,900,000 bytes plus the flag byte plus the 72-byte
 * envelope is under the server's 4 MiB ceiling by construction, and a compressed chunk is smaller
 * still. The unused remainder is left unused — an entry is never split across two chunks.
 */
export const CHUNK_PLAIN_MAX = 3_900_000;

/**
 * The plaintext bound for the INDEX.
 *
 * The index sits where the single blob sat, so it inherits that ceiling (16 MiB sealed · §8.291).
 * It holds one ~110-byte row per chunk plus the account settings, so nothing an account can do
 * brings it near this; the number exists so a reader has a bound to check a compressed frame
 * against instead of trusting what the frame claims about itself.
 */
export const INDEX_PLAIN_MAX = 15_000_000;

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
export type FileListDocument =
  | { v: 1; manifest: Manifest }
  | { v: typeof FILE_LIST_VERSION_CHUNKED; index: ManifestIndexV2 };

/**
 * A chunk's name. The SAME function the parent link uses, deliberately: both commit to the
 * base64url transport string rather than the bytes it encodes, because the string is what travels
 * and the encoding is canonical (fixed alphabet, no padding, one string per byte sequence).
 */
export const chunkFingerprint = manifestFingerprint;

/** The index wire shape. Short keys where version 1 had them; `settings` as §6.3.1 spells it. */
interface WireIndex {
  v: number;
  seq: number;
  p?: string;
  settings?: WireSettings;
  chunks: ManifestChunkRef[];
}

/** The chunk wire shape. */
interface WireChunk {
  v: number;
  seq: number;
  items: WireEntry[];
}

// ------------------------------------------------------------------------------ compression

/**
 * JSON → the plaintext to seal: `flag || payload` (NCF-3 §6.3.4).
 *
 * zstd when this build has an encoder, the platform's gzip when it does not, raw when it has
 * neither. All three are readable by every version-2 reader, so the choice costs nobody anything.
 */
async function pack(json: Uint8Array): Promise<Uint8Array> {
  const codec = zstdCodec();
  if (codec) {
    try {
      return withFlag(FLAG_ZSTD, await codec.compress(json, ZSTD_LEVEL));
    } catch {
      // An encoder that will not run must not cost somebody their save: gzip below writes a
      // document every reader can open, and the only thing lost is ~9 % of the bytes.
    }
  }
  const gz = await gzip(json);
  return gz ? withFlag(FLAG_GZIP, gz) : withFlag(FLAG_RAW, json);
}

/**
 * The sealed plaintext → the JSON bytes inside it.
 *
 * `maxOut` is the caller's bound (a chunk's or the index's). A zstd frame declares what it expands
 * to, so a frame that claims more than the bound is refused HERE — before anything is allocated
 * for it. Every refusal is a `ManifestFormatError` that says which one it was; none of them is
 * ever an empty drive (§6.1's rule).
 */
async function unpack(body: Uint8Array, maxOut: number): Promise<Uint8Array> {
  if (body.length < 1) throw new ManifestFormatError("empty file list body");
  const flag = body[0];
  const rest = body.subarray(1);
  if (flag === FLAG_RAW) return rest;
  if (flag === FLAG_GZIP) {
    const out = await gunzip(rest);
    if (!out) throw new ManifestFormatError("the file list is gzipped and this platform cannot expand it");
    return out;
  }
  if (flag === FLAG_ZSTD) {
    const codec = zstdCodec();
    if (!codec) {
      throw new ManifestFormatError("the file list is zstd-compressed and this build has no zstd decoder");
    }
    const declared = zstdContentSize(rest);
    if (declared === null) {
      throw new ManifestFormatError("the zstd frame does not declare its size, so it cannot be bounded");
    }
    if (declared > maxOut) {
      throw new ManifestFormatError(`the zstd frame claims ${declared} bytes, over the ${maxOut} bound`);
    }
    return codec.decompress(rest, maxOut);
  }
  throw new ManifestFormatError(`unknown file list compression flag ${String(flag)}`);
}

/** The parsed JSON object inside a sealed plaintext, or a `ManifestFormatError` saying why not. */
async function parse(body: Uint8Array, maxOut: number): Promise<Record<string, unknown>> {
  const json = await unpack(body, maxOut);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new ManifestFormatError("file list body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ManifestFormatError("file list body is not an object");
  }
  return { ...parsed };
}

/** The sealed version this document carries — `1` or `2`, or a refusal naming what it said. */
function versionOf(doc: Record<string, unknown>): number {
  const v = doc.v;
  if (typeof v !== "number") throw new ManifestFormatError(`file list has no version (v=${String(v)})`);
  return v;
}

/** The sealed store version, checked the way §6.1 requires: present, positive, and linked. */
function seqOf(doc: Record<string, unknown>, what: string): number {
  const seq = doc.seq;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
    throw new ManifestFormatError(`${what} has no sealed version (seq=${String(seq)})`);
  }
  return seq;
}

// ------------------------------------------------------------------------------ the index

/** The index → the plaintext to seal under `AAD_FILE_LIST`. */
export async function encodeIndex(index: ManifestIndexV2): Promise<Uint8Array> {
  if (!Number.isSafeInteger(index.seq) || index.seq < 1) {
    throw new ManifestFormatError(`file list seq must be a positive integer, got ${index.seq}`);
  }
  // Version 1 has nothing before it; every later version must name what it continued from, or the
  // fork check has a hole exactly where a fork would be introduced (§6.1 check 3).
  if (index.seq > 1 && !index.p) {
    throw new ManifestFormatError(`file list seq ${index.seq} must name the version it was built on`);
  }
  const st = settingsToWire(index.settings);
  const wire: WireIndex = {
    v: FILE_LIST_VERSION_CHUNKED,
    seq: index.seq,
    ...(index.p ? { p: index.p } : {}),
    ...(st ? { settings: st } : {}),
    chunks: index.chunks.map((c) => ({ h: c.h, n: c.n, f: c.f, l: c.l })),
  };
  return pack(new TextEncoder().encode(JSON.stringify(wire)));
}

/** Sealed plaintext → the index. Throws `ManifestFormatError` on anything it cannot read. */
export async function decodeIndex(body: Uint8Array): Promise<ManifestIndexV2> {
  return indexFrom(await parse(body, INDEX_PLAIN_MAX));
}

function indexFrom(doc: Record<string, unknown>): ManifestIndexV2 {
  const v = versionOf(doc);
  if (v !== FILE_LIST_VERSION_CHUNKED) {
    throw new ManifestFormatError(`unsupported file list version ${v}`);
  }
  const seq = seqOf(doc, "file list index");
  const p = doc.p;
  if (seq > 1 && typeof p !== "string") {
    throw new ManifestFormatError(`file list index ${seq} does not say what it was built on`);
  }
  if (!Array.isArray(doc.chunks)) throw new ManifestFormatError("file list index names no chunks");
  const chunks: ManifestChunkRef[] = [];
  for (const raw of doc.chunks) {
    // Every field is load-bearing: the hash IS the pin, and a row missing one of them would leave
    // a chunk that could not be checked. Refusing the index is the only honest answer.
    if (!raw || typeof raw !== "object") throw new ManifestFormatError("file list index has a broken chunk row");
    const row: Record<string, unknown> = { ...raw };
    const { h, n, f, l } = row;
    if (typeof h !== "string" || h === "") throw new ManifestFormatError("a chunk row has no name");
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
      throw new ManifestFormatError(`chunk ${h} does not say how many entries it holds`);
    }
    if (typeof f !== "string" || typeof l !== "string") {
      throw new ManifestFormatError(`chunk ${h} has no placement range`);
    }
    chunks.push({ h, n, f, l });
  }
  const settings = settingsFromWire(doc.settings);
  return {
    v: FILE_LIST_VERSION_CHUNKED,
    seq,
    ...(typeof p === "string" ? { p } : {}),
    ...(settings ? { settings } : {}),
    chunks,
  };
}

// ------------------------------------------------------------------------------ one chunk

/** A chunk → the plaintext to seal under `AAD_FILE_LIST_CHUNK`. */
export async function encodeChunk(doc: ManifestChunkDoc): Promise<Uint8Array> {
  if (!Number.isSafeInteger(doc.seq) || doc.seq < 1) {
    throw new ManifestFormatError(`chunk seq must be a positive integer, got ${doc.seq}`);
  }
  const wire: WireChunk = {
    v: FILE_LIST_VERSION_CHUNKED,
    seq: doc.seq,
    items: doc.items.map(toWire),
  };
  return pack(new TextEncoder().encode(JSON.stringify(wire)));
}

/** Sealed chunk plaintext → its entries. */
export async function decodeChunk(body: Uint8Array): Promise<ManifestChunkDoc> {
  const doc = await parse(body, CHUNK_PLAIN_MAX);
  const v = versionOf(doc);
  if (v !== FILE_LIST_VERSION_CHUNKED) throw new ManifestFormatError(`unsupported chunk version ${v}`);
  const seq = seqOf(doc, "chunk");
  if (!Array.isArray(doc.items)) throw new ManifestFormatError("chunk has no item list");
  return { v: FILE_LIST_VERSION_CHUNKED, seq, items: doc.items.map(fromWire) };
}

// ------------------------------------------------------------------------------ either version

/**
 * The reader's one door: sealed plaintext → whichever version it turned out to be.
 *
 * ⚠ A version-1 body is inflated twice — once here to read `v`, once by `decodeManifest`. That is
 * deliberate rather than a duplicate validator: version 1's rules live in one place and stay
 * there. The cost is bounded and self-extinguishing, because the first save after a version-1 load
 * converts the account (§6.3.6) and no later read takes this branch.
 */
export async function decodeFileList(body: Uint8Array): Promise<FileListDocument> {
  const doc = await parse(body, INDEX_PLAIN_MAX);
  const v = versionOf(doc);
  if (v === FILE_LIST_VERSION_CHUNKED) return { v: FILE_LIST_VERSION_CHUNKED, index: indexFrom(doc) };
  if (v === 1) return { v: 1, manifest: await decodeManifest(body) };
  // An unknown version means another device wrote a format this build predates. Refusing is the
  // safe answer, and §6.1 says the caller must never render the refusal as an empty drive.
  throw new ManifestFormatError(`unsupported file list version ${v}`);
}
