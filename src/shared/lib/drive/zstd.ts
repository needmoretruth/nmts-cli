// The zstd seam for the chunked file list (NCF-3 §6.3.4, flag 0x02). ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// WHY A SEAM AND NOT AN IMPORT. The browser gets zstd from a WebAssembly build it has to fetch,
//   and the command line gets it from Node's own `zlib`. Neither belongs in a module the two
//   share, so this file holds the SHAPE of an encoder and the register that finds one, and each
//   platform hands its own in. A build that registers nothing still reads and writes lists: the
//   writer falls back to gzip (§6.3.4), and only a document that already says 0x02 needs a
//   decoder — which is a refusal the reader names, never an empty drive.
//
// LEVEL 6, MEASURED 2026-09-06 on a synthetic list of 100,000 entries shaped like a real drive
//   (2,000 folders, 98,000 files, random 104-byte wrapped-key and content-hash envelopes,
//   realistic names), compressed as one CHUNK_PLAIN_MAX-sized chunk payload (3,899,634 bytes,
//   10,330 entries) with @bokuweb/zstd-wasm under Node 24:
//
//     level 1 → 2,409,818 B (61.8 %) ·  8.2 ms/MiB
//     level 3 → 2,357,562 B (60.5 %) · 10.3 ms/MiB
//     level 6 → 2,321,378 B (59.5 %) · 32.9 ms/MiB   ← smallest, and well under 100 ms/MiB
//
//   ⚠ The ranking is not a law of zstd — it is a fact about THIS data shape, and it inverts
//   further up: on the same kind of payload, level 10 was measured producing LARGER output than
//   level 3, in three separate zstd builds. So the level is a measurement, never a guess:
//   re-measure on real chunks before moving this number, and do not reason about it.

/**
 * What a platform must provide to write (and read) flag 0x02.
 *
 * `decompress` is given the largest plaintext the caller will accept. It exists so an encoder can
 * refuse a frame that CLAIMS to expand past that bound before it allocates for it — a sealed
 * document is authenticated, but a build that meets a corrupt or hostile one must still not be
 * asked for a gigabyte of memory first.
 */
export interface ZstdCodec {
  compress(bytes: Uint8Array, level: number): Uint8Array | Promise<Uint8Array>;
  decompress(bytes: Uint8Array, maxOut: number): Uint8Array | Promise<Uint8Array>;
}

/** The level a writer asks for. See the measurement in this file's header before changing it. */
export const ZSTD_LEVEL = 6;

let registered: ZstdCodec | null = null;

/** Hand this build its zstd encoder, or `null` to take it away again (tests do the second). */
export function setZstdCodec(codec: ZstdCodec | null): void {
  registered = codec;
}

/** The registered encoder, or null when this build has none. */
export function zstdCodec(): ZstdCodec | null {
  return registered;
}

/** Magic number every zstd frame starts with (RFC 8878 §3.1.1), little-endian on the wire. */
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/**
 * The size the frame SAYS it expands to, or null when the frame does not declare one.
 *
 * Reads only the frame header described by RFC 8878, which is at most 14 bytes, so it costs
 * nothing and — this is the point — it runs BEFORE any buffer is allocated for the output. NCF-3
 * §6.3.4 requires our writers to emit the content size for exactly this reason; a frame without
 * one is not ours and is refused by the caller rather than guessed at.
 */
export function zstdContentSize(frame: Uint8Array): number | null {
  if (frame.length < 6) return null;
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (frame[i] !== MAGIC[i]) return null;
  }
  const descriptor = frame[4] ?? 0;
  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const dictIdFlag = descriptor & 3;
  // Field widths, straight from the frame-header descriptor table in RFC 8878: the content-size
  // field is absent when the flag is 0 unless the frame is one segment, in which case it is a
  // single byte.
  const fcsSize = fcsFlag === 0 ? singleSegment : 1 << fcsFlag;
  if (fcsSize === 0) return null;
  const dictIdSize = dictIdFlag === 0 ? 0 : 1 << (dictIdFlag - 1);
  const at = 5 + (singleSegment === 1 ? 0 : 1) + dictIdSize;
  if (frame.length < at + fcsSize) return null;
  let value = 0;
  for (let i = fcsSize - 1; i >= 0; i -= 1) {
    // Built as a float rather than shifted: an 8-byte field overflows 32-bit shifts, and the only
    // use of this number is a comparison against a bound in the low millions.
    value = value * 256 + (frame[at + i] ?? 0);
  }
  // A two-byte field is stored with 256 subtracted — the one irregular width in that table.
  return fcsSize === 2 ? value + 256 : value;
}
