// Which UPLOAD a record belongs to, and one upload of one file at a time.
//
// ⛔ WHY THIS EXISTS. The records of an unfinished upload are filed under a name that is a pure
//    function of the account, the bytes, the name and the destination (`upload-store.ts`). Two
//    things follow from that, and both were defects:
//
//    · A LATER upload of the same bytes to the same place — after the first was trashed, erased or
//      replaced — rebuilt the first one's idempotency keys once its records were forgotten. Every
//      reservation was refused as "this key already names another blob" (each sealing is fresh, so
//      the blob differs), and a commit under the old key was answered with the OLD file. A run id,
//      made with an upload's first record and kept with it, is what gives each upload keys of its
//      own while a resume still finds the ones it started with.
//    · Two runs of the same put AT ONCE — a gateway retrying a request its client gave up on, or two
//      programs putting the same file — share those records. Each run seals under a file key of its
//      own, and a run that picked up a part the other wrote would commit a file whose parts open
//      under two different keys: paid for, listed, and impossible to read.
//
// ⛔ TWO GUARDS AGAINST THE SECOND, BECAUSE THE RECORD STORE HAS NO LOCK. Inside one process a second
//    run WAITS for the first. Across processes there is nothing to wait on: the store (a directory
//    on a machine, IndexedDB in a page) offers no exclusive create, and a lock made of a read and a
//    write lets both sides believe they hold it. So a run that meets a record another sealing wrote
//    refuses — before it pushes, signs or commits anything of that part — and checks every part
//    once more before the commit.

import { randomBytes } from "@noble/hashes/utils.js";

import { toBase64Url } from "./bytes.ts";
import {
  clearItemRecord,
  clearReservation,
  partKey,
  readReservationRecord,
  type Reservation,
} from "./upload-store.ts";
import { UploadError, type PaidPart } from "./upload-wire.ts";

/** What a refusal over another run's records is known by, for a program to branch on. */
export const UPLOAD_CONFLICT = "UPLOAD_CONFLICT";

/** A name for one upload of a file. Random: it says nothing about the file or the account. */
export function newRunId(): string {
  return toBase64Url(randomBytes(16));
}

/**
 * The run this file's records belong to, or a new one when none of them names one.
 *
 * ⚠ A record an earlier version wrote names none. Its own key stays the one that version used
 *   (`runIdField`); the new id is only for the parts this run is the first to write down.
 */
export async function runIdFor(fileKey: string, parts: number): Promise<string> {
  for (let index = 0; index < parts; index += 1) {
    const record = await readReservationRecord(partKey(fileKey, index));
    if (record?.runId !== undefined) return record.runId;
  }
  return newRunId();
}

/**
 * The run id a part's record is written with: the one it already has, or this upload's.
 *
 * ⛔ A RECORD KEEPS WHAT IT WAS WRITTEN WITH, including nothing. Its reservation is filed under the
 *    key it was made with; giving an earlier version's record a run id now would ask the server
 *    under a key it has never seen and buy the storage a second time.
 */
export function runIdField(existing: Reservation | null, runId: string): { runId?: string } {
  if (existing === null) return { runId };
  return existing.runId === undefined ? {} : { runId: existing.runId };
}

/** The tail of each file's queue: what the next run of that file waits for. */
const queues = new Map<string, Promise<void>>();

/**
 * Run `body` once every earlier run of the same file in this process has finished.
 *
 * ⚠ WAITING, NOT REFUSING. Inside one process the first run is known to be alive, so the honest
 *   answer to a second one is "after it": it then finds a finished upload's records and answers
 *   the same file, or finds none and starts an upload of its own.
 */
export async function oneUploadAtATime<T>(fileKey: string, body: () => Promise<T>): Promise<T> {
  const before = queues.get(fileKey) ?? Promise.resolve();
  let release = (): void => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = before.then(() => mine);
  queues.set(fileKey, tail);
  await before;
  try {
    return await body();
  } finally {
    release();
    // The last run out takes the queue with it, so a long-lived process keeps no entry per file.
    if (queues.get(fileKey) === tail) queues.delete(fileKey);
  }
}

function conflict(paid: boolean): UploadError {
  return new UploadError({
    phase: "reserve",
    code: UPLOAD_CONFLICT,
    message: "Another run is uploading this same file to the same place.",
    paid,
    nextStep:
      "This run stopped before committing anything. Let the other run finish, then run this " +
      "again — it finds that upload's records, or starts one of its own.",
  });
}

/**
 * Refuse a part record that another sealing of this file wrote.
 *
 * ⛔ THE WRAPPED FILE KEY SAYS WHICH SEALING A RECORD BELONGS TO. It is sealed afresh by every
 *    upload that starts from nothing and carried unchanged by every resume, so a record whose key
 *    is not this run's was written by another run — and its bytes open under a key this file's
 *    list entry will not hold.
 */
export function refuseOtherSealing(
  existing: Reservation | null,
  input: { runId: string; entry: { dekWrapped: string } },
): void {
  if (existing === null) return;
  const sameKey = existing.dekWrapped === input.entry.dekWrapped;
  const sameRun = existing.runId === undefined || existing.runId === input.runId;
  if (!sameKey || !sameRun) {
    throw conflict(existing.ledgerId !== undefined || existing.registerTxDigest !== undefined);
  }
}

/**
 * The last look before the commit: every part is still written down as THIS run bought it.
 *
 * ⛔ THE READ AT THE START OF A PART IS NOT ENOUGH ACROSS PROCESSES. Another run can write its own
 *    record over one of these between that read and this commit; the commit names what this run
 *    paid for, so a record that no longer agrees means two sealings are interleaved, and a file
 *    made of both would not open.
 */
export async function confirmParts(
  fileKey: string,
  paid: readonly PaidPart[],
  entry: { dekWrapped: string },
): Promise<void> {
  for (const part of paid) {
    const record = await readReservationRecord(partKey(fileKey, part.partIndex));
    if (record === null || record.dekWrapped !== entry.dekWrapped || record.blobId !== part.blobId) {
      throw conflict(true);
    }
  }
}

/**
 * Forget a finished upload's records: the parts from the last to the first, then the file's own.
 *
 * ⛔ THE ORDER IS WHAT A RUN THAT STARTS IN THE MIDDLE OF IT CAN READ. A live upload's parts are
 *    always written down from the first, so what is left at any moment is a finished upload the
 *    next run recognises — a committed file with the first of its parts still named — or a file
 *    record alone, which names another run and is passed over. Forgetting the file's record first,
 *    or the parts from the front, left the tail of a finished upload looking like the start of a
 *    live one, which the next run would resume into keys the server has already settled.
 */
export async function forgetUpload(fileKey: string, parts: number): Promise<void> {
  for (let index = parts - 1; index >= 0; index -= 1) await clearReservation(partKey(fileKey, index));
  await clearItemRecord(fileKey);
}

/**
 * Forget records that cannot belong to a live upload: a part written down after one that is not,
 * or a file's record with none of its parts.
 *
 * ⛔ WHY THOSE SHAPES MEAN "LEFT OVER". A live upload writes its parts down from the first, one at a
 *    time and each before its money moves; it writes the file's record only once every part is
 *    written down; and nothing removes any of them until the file is committed AND listed. So a gap
 *    in front of a part, or a file record alone, is a finished upload whose forgetting stopped half
 *    way (or ran in the old order). Resuming the first would seal the missing part afresh under a
 *    key the server has already settled for other bytes; resuming the second would answer the old
 *    file for new storage.
 */
export async function dropLeftovers(fileKey: string, parts: number): Promise<void> {
  let gap = false;
  let any = false;
  for (let index = 0; index < parts; index += 1) {
    const present = (await readReservationRecord(partKey(fileKey, index))) !== null;
    any ||= present;
    if (!present) gap = true;
    else if (gap) {
      await forgetUpload(fileKey, parts);
      return;
    }
  }
  if (!any) await clearItemRecord(fileKey);
}
