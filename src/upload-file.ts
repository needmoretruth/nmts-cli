// One local file, from a path to a committed item — however many parts that takes.
//
// ⛔ THIS IS WHERE A FILE BECOMES SEVERAL BLOBS. `upload.ts` buys and fills ONE part; this drives
//    the plan, one part at a time, and then commits them together. Splitting it that way is what
//    lets a file be larger than memory: the file is read a slice at a time and only one part's
//    sealed bytes are ever live.
//
// ⛔ ONE FILE IS ONE COMMIT. The server derives an item's size from the sum of its parts and
//    refuses a set whose indices are not a contiguous 0..n, so there is no such thing as
//    committing half a file. A run that stops between parts has bought and filled storage that
//    nothing in the account can see yet, and the record on disk is what turns that into a resume
//    rather than a loss.
//
// ⛔ THE FILE IS READ TWICE AND THAT IS DELIBERATE. The first pass computes two things at once —
//    the reservation key, and the SHA-256 the account will check the contents against — because
//    both are needed BEFORE the first part is sealed. The second pass is the sealing itself. The
//    alternative is holding the file, which is the thing this module exists to avoid.

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { AAD, type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { fileSecrets, sealPart } from "./seal.ts";
import { planParts } from "./shared/lib/upload/part-plan.ts";
import {
  paddedPlaintextLen,
  type PaddingRule,
} from "./shared/lib/crypto/size-padding.ts";
import { NCF3_SHAPE } from "./seal.ts";
import { buyAndPushPart, entryOf } from "./upload.ts";
import { commitItem } from "./upload-steps.ts";
import {
  finishReservationKey,
  partKey,
  readItemRecord,
  readReservationBytes,
  readReservationRecord,
  startReservationKey,
} from "./upload-store.ts";
import type { BlobProtocol, PaidPart, UploadApi, UploadResult, UploadStep } from "./upload-wire.ts";

/** How much plaintext is handed to the engine at a time. Matches the format's own chunk size. */
const READ_CHUNK_BYTES = 4 * 2 ** 20;

/**
 * Where the plaintext comes from.
 *
 * ⛔ A SEAM, NOT A CONVENIENCE. The tests drive every branch of a multi-part upload — including
 *    the ones that resume after a part was paid for — without a file and without a network. A
 *    module that opened the path itself could only be tested by writing gigabytes to a disk.
 */
export interface PlaintextSource {
  /** Total plaintext bytes. */
  size: number;
  /** Read `[offset, offset + length)`, in pieces small enough to hold. */
  read(offset: number, length: number): AsyncIterable<Uint8Array>;
}

/** Read a file off the disk, a chunk at a time. */
export function fileSource(path: string, size: number): PlaintextSource {
  return {
    size,
    async *read(offset: number, length: number): AsyncIterable<Uint8Array> {
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, length));
        let at = 0;
        while (at < length) {
          const want = Math.min(buffer.length, length - at);
          const { bytesRead } = await handle.read(buffer, 0, want, offset + at);
          if (bytesRead === 0) {
            // ⛔ SHORT IS NOT DONE. The plan was made from the size this file had when it was
            //    measured; a read that ends early means it shrank underneath us, and sealing what
            //    arrived would declare a length the bytes do not match.
            throw new NmtsError(`${path} ended after ${at} of ${length} bytes.`, {
              nextStep: "Nothing was sent. The file changed while it was being read.",
            });
          }
          at += bytesRead;
          yield new Uint8Array(buffer.subarray(0, bytesRead));
        }
      } finally {
        await handle.close();
      }
    },
  };
}

export interface FileUploadInput {
  api: UploadApi;
  protocol: BlobProtocol;
  crypt: CryptoGlue;
  /** The account's data key. Borrowed — the caller wipes it. */
  dataKey: Uint8Array;
  source: PlaintextSource;
  /** What the file is called in the account. */
  name: string;
  /** The folder id it goes in, or null for the root. */
  parentId: string | null;
  /** The destination AS TYPED. Part of the reservation key — see `upload-store.ts`. */
  destination: string;
  relayUrl: string;
  epochs: number;
  currentEpoch: number | null;
  /** How much of the file goes into one part. */
  partSize: number;
  /**
   * How coarsely the file's LAST part is rounded up before sealing, and the billing unit that
   * decides how much of that rounding is free.
   *
   * ⛔ THE ACCOUNT'S CHOICE, NOT THIS TOOL'S. A stored stream states in the clear the length it was
   *    sealed from, so without this the exact byte length of everything this tool uploads is
   *    legible to anybody who fetches it from the storage network. Rounding differently from the
   *    browser would be worse than not rounding: it would say which program uploaded the file.
   */
  padding: { rule: PaddingRule; unitBytes: number };
  onStep?: (step: FileUploadStep) => void;
}

/** Told about each part as it starts, so a long upload visibly moves. */
export type FileUploadStep =
  | { step: "planning"; parts: number; partSize: number }
  | { step: "hashing"; parts: number }
  | { step: "sealing"; partIndex: number; parts: number; bytes: number }
  | ({ partIndex: number; parts: number } & UploadStep);

/**
 * Upload one file and return what the caller must write into the account's file list.
 *
 * ⛔ IT DOES NOT WRITE THE FILE LIST, and the caller must — before clearing the records. A
 *    committed file the list does not name is invisible and, to the person, indistinguishable from
 *    one that never uploaded.
 */
export async function uploadFile(input: FileUploadInput): Promise<UploadResult> {
  const { dataKey, source, onStep } = input;
  if (source.size <= 0) {
    throw new NmtsError("An empty file cannot be uploaded.", {
      nextStep: "The storage network has nothing to store and would refuse the reservation.",
    });
  }
  const plan = planParts(source.size, input.partSize);
  onStep?.({ step: "planning", parts: plan.length, partSize: input.partSize });

  // ── pass one: the reservation key and the content hash, from a single read ──
  onStep?.({ step: "hashing", parts: plan.length });
  const keyHash = startReservationKey(dataKey);
  const contentDigest = await hashWhole(source, keyHash);
  const fileKey = finishReservationKey(keyHash, input.name, input.destination);

  // ⛔ ALREADY COMMITTED STOPS HERE, BEFORE ANY PART IS TOUCHED. A file that got as far as
  //    `POST /v1/items` exists and is paid for; all that can still be missing is the account's own
  //    list. Asking the server about every part again would be a round trip per part to learn
  //    something the record already says.
  const committed = readItemRecord(fileKey);
  if (committed?.itemId !== undefined) {
    const entry = recordedEntry(fileKey, plan.length, source.size);
    if (entry !== null) {
      return { itemId: committed.itemId, resumed: true, ledgerIds: [], fileKey, parts: plan.length, entry };
    }
  }

  // ── the file's secrets: from the record if one exists, otherwise made now ──
  const secrets = openSecrets(input, fileKey, plan.length, contentDigest);
  try {
    const entry = {
      name: input.name,
      parentId: input.parentId,
      plaintextLen: source.size,
      dekWrapped: secrets.dekWrapped,
      contentHashCt: secrets.contentHashCt,
    };
    const paid: PaidPart[] = [];
    for (const range of plan) {
      const key = partKey(fileKey, range.partIndex);
      const stored = readReservationRecord(key);
      // ⛔ A PART THAT IS WRITTEN DOWN IS NEVER SEALED AGAIN. Its bytes are a particular sealing
      //    the treasury may already have paid to register; a fresh one is a different blob.
      // ⛔ THE LAST PART ONLY. Every reader recovers the parts' real lengths from the file's size
      //    and what each stream declares, and that answer is unique only because the earlier parts
      //    are exactly full. Padding one of them would not fail here — it would fail years later,
      //    as a download that wrote padding into the middle of a file.
      const isLast = range.partIndex === plan.length - 1;
      const sealFrom = isLast
        ? paddedPlaintextLen(range.length, input.padding.rule, {
            unitBytes: input.padding.unitBytes,
            shape: NCF3_SHAPE,
          })
        : range.length;
      const sealed =
        stored === null
          ? await sealPartOf(input, secrets.dek, range, plan.length, sealFrom)
          : readReservationBytes(key);
      paid.push(
        await buyAndPushPart({
          api: input.api,
          protocol: input.protocol,
          key,
          sealed,
          relayUrl: input.relayUrl,
          epochs: input.epochs,
          currentEpoch: input.currentEpoch,
          // ⚠ The length the STREAM declares, which for a padded last part is more than the file
          //   contributes. The list entry keeps the file's real size; this is what was sealed.
          part: { index: range.partIndex, total: plan.length, plaintextLen: sealFrom },
          entry,
          onStep: (step) => onStep?.({ ...step, partIndex: range.partIndex, parts: plan.length }),
        }),
      );
    }
    const itemId = await commitItem(
      {
        api: input.api,
        epochs: input.epochs,
        currentEpoch: input.currentEpoch,
        entry,
        onStep: (step) => onStep?.({ ...step, partIndex: plan.length - 1, parts: plan.length }),
      },
      fileKey,
      paid,
    );
    return {
      itemId,
      resumed: paid.every((part) => part.resumed),
      ledgerIds: paid.map((part) => part.ledgerId),
      fileKey,
      parts: plan.length,
      entry,
    };
  } finally {
    secrets.dek.fill(0);
  }
}

/** The file key's records, so a caller can clear them once the list is written. */
export function partKeysOf(fileKey: string, parts: number): string[] {
  return Array.from({ length: parts }, (_, index) => partKey(fileKey, index));
}

/** Read the whole file once, feeding the key hash and returning the content digest. */
async function hashWhole(
  source: PlaintextSource,
  keyHash: ReturnType<typeof startReservationKey>,
): Promise<Uint8Array> {
  const content = createHash("sha256");
  for await (const chunk of source.read(0, source.size)) {
    keyHash.update(chunk);
    content.update(chunk);
  }
  return new Uint8Array(content.digest());
}

/**
 * The file's key and sealed content hash — from a written-down part if there is one.
 *
 * ⛔ A RESUMED RUN MUST NOT MAKE A NEW KEY. Every part of this file was sealed under one key, and
 *    the bytes already on the network cannot be re-sealed. Unwrapping the recorded one is what
 *    makes the parts still to come belong to the same file.
 */
function openSecrets(
  input: FileUploadInput,
  fileKey: string,
  parts: number,
  contentDigest: Uint8Array,
): { dek: Uint8Array; dekWrapped: string; contentHashCt: string } {
  for (const key of partKeysOf(fileKey, parts)) {
    const record = readReservationRecord(key);
    if (record === null) continue;
    const wrapped = new Uint8Array(Buffer.from(record.dekWrapped, "base64url"));
    const dek = input.crypt.envelope_open(
      input.dataKey,
      new TextEncoder().encode(AAD.dekWrap),
      wrapped,
    );
    return { dek, dekWrapped: record.dekWrapped, contentHashCt: record.contentHashCt };
  }
  return fileSecrets(input.crypt, input.dataKey, contentDigest);
}

async function sealPartOf(
  input: FileUploadInput,
  dek: Uint8Array,
  range: { partIndex: number; offset: number; length: number },
  parts: number,
  sealFrom: number,
): Promise<Uint8Array> {
  input.onStep?.({
    step: "sealing",
    partIndex: range.partIndex,
    parts,
    bytes: sealFrom,
  });
  return sealPart(input.crypt, dek, padded(input.source.read(range.offset, range.length), range.length, sealFrom), {
    index: range.partIndex,
    total: parts,
    plaintextLen: sealFrom,
  });
}

/**
 * The part's bytes, followed by zeros up to the length it will declare.
 *
 * ⛔ ZEROS APPENDED TO THE PLAINTEXT, NOT BYTES TACKED ONTO THE STORED STREAM. A stream's header is
 *    authenticated but not encrypted, so padding added after sealing would leave the real length
 *    legible in the header of a public object — which is the exact thing this is for.
 */
async function* padded(
  chunks: AsyncIterable<Uint8Array>,
  real: number,
  sealFrom: number,
): AsyncIterable<Uint8Array> {
  for await (const chunk of chunks) yield chunk;
  let left = sealFrom - real;
  const zeros = new Uint8Array(Math.min(left, 1 << 20));
  while (left > 0) {
    const take = Math.min(left, zeros.length);
    yield zeros.subarray(0, take);
    left -= take;
  }
}

export { entryOf };

/**
 * The file list entry a written-down part remembers.
 *
 * ⛔ FROM THE RECORD, NEVER FROM THE RUN. The key that opens the stored bytes is the key they were
 *    sealed with. A run that wrote its own freshly generated one into the list would produce a
 *    file that is paid for, present, correctly named and impossible to open.
 */
function recordedEntry(
  fileKey: string,
  parts: number,
  size: number,
): UploadResult["entry"] | null {
  for (const key of partKeysOf(fileKey, parts)) {
    const record = readReservationRecord(key);
    if (record === null) continue;
    return {
      name: record.name,
      parentId: record.parentId,
      plaintextLen: size,
      dekWrapped: record.dekWrapped,
      contentHashCt: record.contentHashCt,
    };
  }
  return null;
}
