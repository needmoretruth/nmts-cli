// How a drive is changed through the gateway: a file stored at a key, a folder made by its marker,
// what is at a set of keys sent to the trash. `drive.ts` builds one of these for every drive that
// may be written.
//
// ⛔ EVERY DECISION IS TAKEN INSIDE THE KEY'S LOCK, ON A LIST READ THERE (`drive-lock.ts`). Whether
//    the key is free, whether a condition holds, whether the bytes are the ones already stored —
//    each is a fact about the list at one moment, and a list cached for seconds, or read before
//    another write to the same key finished, answers them for a moment that has passed.
//
// ⛔ THE TAG ANSWERED IS THE TAG OF THE FILE THIS REQUEST STORED, found by the id the store
//    returned. "Whatever is at the key afterwards" was somebody else's file whenever another write
//    landed in between — and a client that holds a tag which never belonged to its own upload
//    compares every later listing against the wrong thing.

import { mkdir as makeDir, rm as removeFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { fileSink } from "../download-sink-node.ts";
import { NmtsError } from "../errors.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { S3Refusal } from "./answer.ts";
import type { DriveWriter, RemoveOutcome, StoreOutcome, WriteMeta } from "./contract.ts";
import type { DriveAccount } from "./drive.ts";
import { checkWriteCondition, UNCONDITIONAL, type WriteCondition } from "./drive-conditions.ts";
import { checkKey, sameKey } from "./drive-key.ts";
import { checkDeclaredSize, checkNotEmpty, tooLarge } from "./drive-limits.ts";
import type { KeyLocks } from "./drive-lock.ts";
import { trashedHolders } from "./drive-trashed-name.ts";
import { EMPTY_ETAG, isFolderKey, objectsOf, type DriveObject } from "./listing.ts";
import { spoolFileName } from "./multipart-sweep.ts";
import { KeyConflict, refusalFor, verdictFor } from "./same-file.ts";
import { readBodyText, spoolBody } from "./spool.ts";
import type { StagingStore } from "./staging.ts";

/** Everything the writer needs from the drive it writes. */
export interface WriterSetup {
  readonly account: DriveAccount;
  /** The drive's list: cached, or `fresh` past the cache. */
  readonly entries: (asked?: { readonly fresh?: boolean }) => Promise<readonly ManifestEntry[]>;
  /** Drop the cached list, after a write. */
  readonly forget: () => void;
  readonly stagingRoot: string;
  readonly staging: StagingStore;
  readonly bucket: string;
  readonly owner: () => Promise<string | null>;
  readonly locks: KeyLocks;
  readonly overwrite: "replace" | "refuse";
  readonly maxObjectBytes: number | undefined;
  readonly onAlreadyStored: ((key: string) => void) | undefined;
}

/** `photos/2026/a.jpg` → the folder to make and the name to store under. */
export function placeOf(key: string): { folder: string | undefined; name: string } {
  const at = key.lastIndexOf("/");
  if (at < 0) return { folder: undefined, name: key };
  const folder = key.slice(0, at);
  return { folder: folder === "" ? undefined : folder, name: key.slice(at + 1) };
}

/**
 * Refuse a key that a folder, or a file above it, already stands in the way of.
 *
 * ⛔ A FILE AND A FOLDER CANNOT SHARE A PATH, and the upload path, handed one that did, stored the
 *    file as `photos (2)` — a 500 for a key that still held nothing, and another stored copy on
 *    every retry. That is a conflict about the key, so it is a 409.
 */
function refuseClash(objects: readonly DriveObject[], key: string): void {
  const byKey = new Map(objects.map((o) => [sameKey(o.key), o]));
  const path = isFolderKey(key) ? key.slice(0, -1) : key;
  if (!isFolderKey(key) && byKey.has(sameKey(`${key}/`))) {
    throw new KeyConflict(`A folder is already at ${key}, so no file can be stored at that key.`);
  }
  const names = path.split("/");
  for (let depth = isFolderKey(key) ? names.length : names.length - 1; depth > 0; depth -= 1) {
    const above = names.slice(0, depth).join("/");
    const standing = byKey.get(sameKey(above));
    if (standing !== undefined && !isFolderKey(standing.key)) {
      throw new KeyConflict(`A file is already at ${above}, so nothing can be stored inside it.`);
    }
  }
}

/**
 * Refuse, on the list as it is cached, a write whose answer is already known: a folder in the way,
 * or a condition that does not hold. The protocol layer asks this before reading a body, so a
 * refusal it can know keeps its own status and costs nobody an upload; the writer asks again,
 * inside the key's lock, and that answer is the one that decides.
 */
export function precheck(objects: readonly DriveObject[], key: string, condition: WriteCondition): void {
  refuseClash(objects, key);
  const folder = isFolderKey(key);
  checkWriteCondition(
    objects.find((o) => isFolderKey(o.key) === folder && sameKey(o.key) === sameKey(key)),
    condition,
  );
}

/** The id `store` answered with, when it answered one. */
function storedId(stored: unknown): string | null {
  if (typeof stored !== "object" || stored === null) return null;
  const id: unknown = Reflect.get(stored, "id");
  return typeof id === "string" && id !== "" ? id : null;
}

export function createWriter(setup: WriterSetup): DriveWriter {
  const { account, locks, overwrite } = setup;
  const max = setup.maxObjectBytes;
  const lockName = (key: string): string => `${setup.bucket}\u0000${sameKey(key)}`;
  const fresh = async (): Promise<DriveObject[]> => objectsOf(await setup.entries({ fresh: true }));

  /**
   * Store one local file at a drive key, making the folders above it if they are missing.
   *
   * ⭐ IDENTICAL CONTENT IS NOT AN ERROR. Nothing is sent and nothing is charged, and the caller is
   *    told the upload finished — because the statement it was making, "that file is at that key",
   *    is true. Answering 409 there is what made every backup run fail on every file it had already
   *    stored, and a sync tool writes 409 down as a failure.
   *
   * ⛔ UNDER `replace`, EVERY STORE ASKS FOR THE OVERWRITE RULE, not only the ones this list says
   *    are taken: another device can put a file at the key between this read and the store, and the
   *    rename rule would then store this one beside it as `name (2)`.
   */
  const storeFile = (key: string, path: string, meta: WriteMeta, condition: WriteCondition = UNCONDITIONAL) =>
    locks.run([lockName(key)], async (): Promise<StoreOutcome> => {
      checkKey(key);
      const { folder, name } = placeOf(key);
      const known = await setup.entries({ fresh: true });
      const objects = objectsOf(known);
      refuseClash(objects, key);
      const standing = objects.find((o) => !isFolderKey(o.key) && sameKey(o.key) === sameKey(key));
      checkWriteCondition(standing, condition);
      const size = (await stat(path)).size;
      checkNotEmpty(size);
      if (max !== undefined && size > max) throw tooLarge(max);
      if (standing !== undefined) {
        if (standing.key !== key) {
          if (overwrite !== "replace") throw refusalFor("spelling", key, standing.key);
        } else {
          const verdict = await account.withCode((code) => verdictFor(standing, code, path));
          if (verdict === "same") {
            setup.onAlreadyStored?.(key);
            return { etag: standing.etag, outcome: "unchanged" };
          }
          if (overwrite !== "replace") throw refusalFor(verdict === "free" ? "differs" : verdict, key);
        }
      }

      if (folder !== undefined) await account.makeFolder(folder);
      // ⛔ A NAME ONLY THE TRASH HOLDS IS FREE TO S3, so the trashed holder moves aside first
      //    (`drive-trashed-name.ts`) — otherwise the upload path numbers this file instead.
      if (account.freeTrashedName !== undefined && trashedHolders(known, folder, name).length > 0) {
        await account.freeTrashedName(folder, name);
      }
      const stored = await account.store(path, name, folder, { replace: overwrite === "replace", meta });
      setup.forget();
      const after = await fresh();
      const id = storedId(stored);
      const mine = id === null ? after.find((o) => o.key === key) : after.find((o) => o.entry.id === id);
      if (mine === undefined) {
        throw new NmtsError(`The file was stored, but the file list does not show it at ${key}.`);
      }
      if (mine.key !== key) {
        throw new KeyConflict(
          `Something else was stored at ${key} while this upload was, so this one was stored as ${mine.key}.`,
        );
      }
      return { etag: mine.etag, outcome: standing === undefined ? "stored" : "replaced" };
    });

  /** A zero-byte PUT to `photos/`: the folder, made if it is missing, and the empty object's tag. */
  const makeMarker = (key: string, condition: WriteCondition) =>
    locks.run([lockName(key)], async (): Promise<StoreOutcome> => {
      const objects = await fresh();
      refuseClash(objects, key);
      const standing = objects.find((o) => isFolderKey(o.key) && sameKey(o.key) === sameKey(key));
      checkWriteCondition(standing, condition);
      if (standing !== undefined) return { etag: EMPTY_ETAG, outcome: "unchanged" };
      await account.makeFolder(key.slice(0, -1));
      setup.forget();
      return { etag: EMPTY_ETAG, outcome: "stored" };
    });

  /** A fresh 0600 file under the staging root, removed whatever `use` does. */
  const withSpool = async <T>(use: (path: string) => Promise<T>): Promise<T> => {
    await makeDir(setup.stagingRoot, { recursive: true, mode: 0o700 });
    const spool = join(setup.stagingRoot, spoolFileName());
    try {
      return await use(spool);
    } finally {
      await removeFile(spool, { force: true });
    }
  };

  const remove = (keys: readonly string[], condition: WriteCondition = UNCONDITIONAL) =>
    locks.run(keys.map(lockName), async (): Promise<RemoveOutcome[]> => {
      const objects = await fresh();
      const outcomes: RemoveOutcome[] = keys.map((key) => ({ key, error: null }));
      const going: Array<{ at: number; key: string; path: string }> = [];
      const seen = new Set<string>();
      keys.forEach((key, at) => {
        const object = objects.find((o) => o.key === key) ?? objects.find((o) => sameKey(o.key) === sameKey(key));
        try {
          checkWriteCondition(object, condition);
        } catch (error) {
          outcomes[at] = { key, error };
          return;
        }
        // Not there, or named twice: gone either way, which is what S3 answers.
        if (object === undefined || seen.has(object.key)) return;
        seen.add(object.key);
        // ⛔ A FOLDER MARKER NAMES THE FOLDER, NOT WHAT IS IN IT. Deleting `photos/` while files are
        //    under it would trash every one of them; in S3 it removes an empty object and leaves the
        //    files. So a folder goes to the trash only once nothing live is left inside it.
        if (isFolderKey(object.key) && objects.some((o) => o.key !== object.key && o.key.startsWith(object.key))) return;
        going.push({ at, key, path: `/${isFolderKey(object.key) ? object.key.slice(0, -1) : object.key}` });
      });

      let failed = going;
      if (going.length > 1 && account.trashMany !== undefined) {
        try {
          await account.trashMany(going.map((g) => g.path));
          failed = [];
        } catch {
          // One key the batch could not take refuses the whole write; each is tried on its own.
        }
      }
      const errors = new Map<number, unknown>();
      for (const one of failed) {
        try {
          await account.trash(one.path);
        } catch (error) {
          errors.set(one.at, error);
        }
      }
      setup.forget();
      if (errors.size > 0) {
        // ⛔ A KEY ALREADY GONE IS DELETED, whoever sent it to the trash first.
        const now = await fresh();
        for (const [at, error] of errors) {
          const key = keys[at] ?? "";
          if (now.some((o) => o.key === key)) outcomes[at] = { key, error };
        }
      }
      return outcomes;
    });

  return {
    put: async (key, body, meta, condition = UNCONDITIONAL) => {
      checkKey(key);
      if (isFolderKey(key)) {
        if (body.size !== 0) {
          throw new S3Refusal(
            400,
            "InvalidArgument",
            "A key ending in `/` names a folder, and a folder holds no bytes of its own. Nothing was stored.",
          );
        }
        await readBodyText(body, 0, "A folder marker");
        return await makeMarker(key, condition);
      }
      checkNotEmpty(body.size);
      checkDeclaredSize(body.size, max);
      // ⛔ THE BODY IS SPOOLED TO A FILE FIRST, 0600, and deleted whatever happens. The upload
      //    path reserves storage, cuts parts and seals them from a file; ⛔ `spoolBody` returns
      //    only once the body's own rules held, so nothing reaches `storeFile` before that.
      return await withSpool(async (spool) => {
        await spoolBody(body, spool, { md5: false, limit: max });
        return await storeFile(key, spool, meta, condition);
      });
    },
    // ⚠ A COPY IS A DOWNLOAD AND AN UPLOAD. The bytes are sealed under the source file's own key,
    //   which the destination does not hold, so there is nothing to copy but the plaintext —
    //   fetched into a spool, checked against its recorded hash on the way, and stored like any
    //   other upload, same-file rule and all.
    copy: async (from, key, meta, condition = UNCONDITIONAL) => {
      checkKey(key);
      if (isFolderKey(key)) {
        throw new S3Refusal(400, "InvalidArgument", "A copy cannot be stored at a key ending in `/`, which names a folder.");
      }
      checkNotEmpty(from.object.size);
      checkDeclaredSize(from.object.size, max);
      return await withSpool(async (spool) => {
        await from.source.fetch(from.object, fileSink(spool, { force: false }));
        return await storeFile(key, spool, meta, condition);
      });
    },
    remove,
    multipart: setup.staging.view(setup.bucket, { store: storeFile, owner: setup.owner, maxObjectBytes: max }),
    maxObjectBytes: max,
  };
}
