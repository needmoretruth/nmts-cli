// Reading part of a file: from the stored part a range starts in, not from the file's first byte.
//
// ⛔ WHY THIS EXISTS. An S3 client fetches a large object as many ranges at once — eight MiB each,
//    ten at a time — and a reader that decrypted every range from the file's first byte made a 1 GB
//    file cost about 64 GB of reads, with the late ranges timing out. Every part of a file is its own
//    sealed stream, so the parts wholly before a range can be left out: their headers (72 bytes
//    each) say how long they are, and the range begins in the part where those lengths run out.
//    Inside that part the read starts at the part's first chunk and stops at the chunk the range
//    ends in, because the sequential opener is the one this tool's engine surface offers.
//
// ⛔ WHAT A RANGE IS CHECKED AGAINST. Every chunk it keeps is authenticated under the file's key.
//    Every part it touches — the ones it leaves out included — has its header's key commitment
//    checked and its sealed position compared with the position it is used in, so authentic bytes
//    cannot be answered from the wrong place. The whole-file digest needs every byte from the first,
//    so it is checked only when nothing was left out and the range runs to the file's end; that is
//    the one range the whole-file path checked before, and it still is.
//
// ⚠ ONLY FOR A SINK THAT NAMES A WINDOW AND CAN BE TOLD WHAT WAS LEFT OUT (`PlaintextSink.window`
//   with `skip`). Every other sink goes through `download.ts` exactly as before.

import { sha256 } from "@noble/hashes/sha2.js";

import type { CryptoGlue } from "./crypto.ts";
import { checkedHeader, fetchPart, openPart, type PartHeader, type PartView } from "./download-part.ts";
import type { FetchedFile } from "./download.ts";
import type { PlaintextSink } from "./download-sink.ts";
import { NmtsError } from "./errors.ts";
import { NCF3_SHAPE } from "./seal.ts";
import type { ReadOptions } from "./walrus.ts";

/** The bytes a sink keeps, when it keeps only some of the file and can be told what was left out. */
export function windowOf(sink: PlaintextSink): { start: number; end: number } | null {
  const window = sink.window ?? null;
  return window !== null && sink.skip !== undefined ? window : null;
}

/**
 * Where a read of one part may stop: just past the chunk holding its last wanted byte, or null for
 * the whole part.
 */
function prefixEnd(header: PartHeader, lastWanted: number): number | null {
  const step = header.chunkSize + NCF3_SHAPE.tagLen;
  const chunks = header.declared === 0 ? 1 : Math.ceil(header.declared / header.chunkSize);
  const lastChunk = Math.floor(lastWanted / header.chunkSize);
  return lastChunk >= chunks - 1 ? null : NCF3_SHAPE.headerLen + (lastChunk + 1) * step;
}

function disagree(what: string): NmtsError {
  return new NmtsError(what, {
    nextStep: "The file list and the stored parts do not agree. Nothing more was written.",
  });
}

/**
 * Deliver `window` of the file to `sink`, reading only the parts it falls in.
 *
 * ⛔ THE SINK IS COMMITTED IN ONE PLACE AND ABANDONED ON EVERY OTHER WAY OUT, as in `download.ts`.
 */
export async function collectWindow(
  crypt: CryptoGlue,
  ordered: readonly PartView[],
  dek: Uint8Array,
  expected: Uint8Array | null,
  size: number,
  chain: string,
  read: ReadOptions | undefined,
  sink: PlaintextSink,
  window: { start: number; end: number },
): Promise<FetchedFile> {
  const hasher = sha256.create();
  // ⚠ True until a part is left out: the digest is of every byte, and then it can no longer be had.
  let whole = true;
  let at = 0;
  const total = ordered.length;
  try {
    sink.expect(size);
    for (let index = 0; index < total && at <= window.end; index += 1) {
      const part = ordered[index];
      if (part === undefined) continue;
      const isLast = index === total - 1;
      const headerBytes = await fetchPart(part, chain, { ...(read ?? {}), range: { start: 0, end: NCF3_SHAPE.headerLen } });
      const header = checkedHeader(crypt, dek, part, headerBytes, { index, total });
      // Every part but the last contributes all it declares; the last is what the file has left.
      const contributes = isLast ? size - at : header.declared;
      if (contributes < 0 || contributes > header.declared) {
        throw disagree(`Part ${part.part_index} holds ${header.declared} bytes and would have to give ${contributes}.`);
      }
      if (!isLast && at + contributes <= window.start) {
        sink.skip?.(contributes);
        whole = false;
        at += contributes;
        continue;
      }
      const lastWanted = Math.min(window.end, at + contributes - 1) - at;
      const end = contributes === 0 ? null : prefixEnd(header, lastWanted);
      const sealed = await fetchPart(part, chain, end === null ? read : { ...(read ?? {}), range: { start: 0, end } });
      at += await openPart(
        crypt,
        dek,
        part,
        sealed,
        { index, total },
        size - at,
        async (body) => {
          if (whole) hasher.update(body);
          await sink.write(body);
        },
        end !== null,
      );
      if (end !== null) break;
    }
    if (at <= window.end) throw disagree(`The stored parts end at byte ${at}, before the range does.`);
    const checked = whole && at === size && expected !== null;
    if (checked) {
      const got = hasher.digest();
      if (expected.length !== got.length || !expected.every((b, i) => b === got[i])) {
        throw new NmtsError("The file came back whole but does not match the hash this account recorded for it.", {
          nextStep: "The bytes themselves are not the ones that were uploaded.",
        });
      }
    }
    const delivered = await sink.commit();
    return { byteCount: size, partCount: total, contentHashChecked: checked, delivered };
  } catch (failure) {
    await sink.abandon();
    throw failure;
  } finally {
    dek.fill(0);
    expected?.fill(0);
  }
}
