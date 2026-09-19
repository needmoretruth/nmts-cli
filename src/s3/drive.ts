// One account behind the gateway: its file list, its reader, and the rule every upload passes.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, WHICH IS THE WHOLE REASON THIS FILE EXISTS. `nmts s3` serves
//    the drive of whoever is at this machine; the SDK's gateway serves whichever account a
//    business's resolver hands back. What the two do with an upload -- spool it, ask whether the
//    key already holds exactly these bytes, make the folders above it, store it, forget the cached
//    list -- is the same work, and a second copy of it would be a second place for the same-file
//    rule to be got right. The two differ only in where the account comes from, which is the seam
//    below.
//
// ⛔ THE SAME-FILE QUESTION IS ANSWERED HERE AND NOWHERE ELSE. Both ways of uploading -- one PUT,
//    or pieces staged and joined -- end in `storeFile`, so a rule written here cannot disagree with
//    itself; written in the protocol layer it would have to be written twice, once for each, and
//    the two would differ the first time one of them changed.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir as makeDir, rm as removeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { PlaintextSink } from "../download-sink.ts";
import { fetchFile } from "../download.ts";
import { NmtsError } from "../errors.ts";
import type { Network } from "../network.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ReadOptions } from "../walrus.ts";
import type { DriveObject } from "./listing.ts";
import { refusalFor, verdictForKey } from "./same-file.ts";
import type { DriveSource } from "./server.ts";
import { createStaging, type Staging } from "./staging.ts";

/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts.
 */
export const LIST_CACHE_MS = 5_000;

/**
 * Where a drive comes from, for whoever is running the gateway.
 *
 * ⛔ SIX FUNCTIONS AND NO CREDENTIAL. The command-line tool holds an open session; the SDK holds a
 *    client whose key may be in a business's sealed store and is borrowed one call at a time.
 *    Nothing in this file may care which, so nothing in this file is handed a key -- `withCode`
 *    borrows one for the length of a comparison and the caller decides what that costs.
 */
export interface DriveAccount {
  /** The account's file list, read fresh from the server. Empty for an account that has none. */
  readList(): Promise<readonly ManifestEntry[]>;
  /**
   * Borrow the account's code for the length of `use`.
   *
   * ⚠ ASKED FOR ONE THING ONLY: opening the hash this drive recorded for a file already at the key,
   *   which is sealed under the account's own data key and cannot be compared without it.
   */
  withCode<T>(use: (code: string) => Promise<T>): Promise<T>;
  /** Make this folder path, and any folder above it that is missing. */
  makeFolder(path: string): Promise<void>;
  /** Store one local file under `name`, in `folder` — the top of the account when undefined. */
  store(local: string, name: string, folder: string | undefined): Promise<void>;
  /** Send one path — with its leading slash — to the trash, where it stays for thirty days. */
  trash(path: string): Promise<void>;
  /** Fetch, decrypt and deliver one file into the sink. `fetchObject` below is how both do it. */
  fetch(object: DriveObject, sink: PlaintextSink): Promise<void>;
}

export interface DriveSourceOptions {
  readonly account: DriveAccount;
  /**
   * Where the pieces of a multipart upload wait until they are one file.
   *
   * ⛔ 0700, AND MADE WHEN IT IS FIRST NEEDED. Pieces are somebody's plaintext; leaving them in a
   *    shared temporary directory under a predictable name would put them where any other account
   *    on the machine could read them, for as long as the upload takes and afterwards.
   */
  readonly stagingRoot: string;
  /**
   * False makes this drive read only, and that is a refusal rather than a gap — the gateway
   * answers every write with the sentence naming what would allow it.
   */
  readonly writable: boolean;
  /**
   * The staging an earlier source for the same bucket was using, when there was one.
   *
   * ⛔ AN UPLOAD IN PIECES OUTLIVES THE SOURCE IT BEGAN UNDER. A caller that rebuilds its sources —
   *    a gateway re-asking whose bucket this is — would otherwise hand the next piece to a staging
   *    that has never heard of the upload, and a large file could never finish.
   */
  readonly multipart?: Staging | undefined;
  /** How long a file list may be reused. `LIST_CACHE_MS` unless a caller has a reason. */
  readonly listCacheMs?: number | undefined;
  /**
   * Told the key when it already held exactly these bytes, so nothing was sent.
   *
   * ⭐ NOT AN ERROR. An unchanged file costs nothing to re-offer, which is what stops a backup that
   *    runs nightly paying for the nights nothing changed. The words a person reads are the
   *    caller's — this file has no terminal.
   */
  readonly onAlreadyStored?: ((key: string) => void) | undefined;
}

/** Everything `fetchObject` needs to open one file: where to ask, and whose key opens it. */
export interface ObjectReader {
  readonly server: string;
  /**
   * What goes in the one header the server reads: an API key, or a delegation token.
   *
   * ⛔ NAMED FOR WHAT IT IS RATHER THAN FOR ONE OF THE TWO. A field called `apiKey` carrying a
   *    delegation token is how a reader comes to believe a delegated client cannot do something it
   *    can.
   */
  readonly bearer: string;
  readonly code: string;
  readonly chain: Network;
  /** Hosts to read stored bytes from, instead of the network's own aggregators. */
  readonly read?: ReadOptions | undefined;
}

/**
 * `photos/2026/a.jpg` → the folder to make and the name to store under.
 *
 * A key with no slash lands at the top of the account, which is `undefined` rather than `""`: the
 * two mean the same thing to a person and different things to the upload path.
 */
export function placeOf(key: string): { folder: string | undefined; name: string } {
  const at = key.lastIndexOf("/");
  if (at < 0) return { folder: undefined, name: key };
  const folder = key.slice(0, at);
  return { folder: folder === "" ? undefined : folder, name: key.slice(at + 1) };
}

/** The real reader: the stored bytes, opened with this account's key and delivered to the sink. */
export async function fetchObject(
  reader: ObjectReader,
  object: DriveObject,
  sink: PlaintextSink,
): Promise<void> {
  const wrapped = object.entry.dekWrapped;
  if (wrapped === undefined) throw new NmtsError("That entry has no key in the file list.");
  await fetchFile({
    base: reader.server,
    apiKey: reader.bearer,
    accountCode: reader.code,
    itemId: object.entry.id,
    size: object.size,
    dekWrapped: wrapped,
    contentHashCt: object.entry.contentHashCt,
    chain: reader.chain,
    sink,
    ...(reader.read === undefined ? {} : { read: reader.read }),
  });
}

/** One account as the protocol layer sees it: a cached list, a reader, and a writer when allowed. */
export function createDriveSource(options: DriveSourceOptions): DriveSource {
  const account = options.account;
  const cacheMs = options.listCacheMs ?? LIST_CACHE_MS;

  let cached: readonly ManifestEntry[] = [];
  let cachedAt = 0;
  const entries = async (): Promise<readonly ManifestEntry[]> => {
    if (Date.now() - cachedAt < cacheMs) return cached;
    cached = await account.readList();
    cachedAt = Date.now();
    return cached;
  };

  /**
   * Store one local file at a drive key, making the folders above it if they are missing.
   *
   * ⭐ IDENTICAL CONTENT IS NOT AN ERROR. Nothing is sent and nothing is charged, and the caller is
   *    told the upload finished — because the statement it was making, "that file is at that key",
   *    is true. Answering 409 there is what made every backup run fail on every file it had already
   *    stored, and a sync tool writes 409 down as a failure.
   */
  const storeFile = async (key: string, path: string): Promise<void> => {
    const { folder, name } = placeOf(key);
    const known = await entries();
    const verdict = await account.withCode((code) => verdictForKey(known, key, code, path));
    if (verdict === "same") {
      options.onAlreadyStored?.(key);
      return;
    }
    if (verdict !== "free") throw refusalFor(verdict, key);

    if (folder !== undefined) await account.makeFolder(folder);
    await account.store(path, name, folder);
    cachedAt = 0;
  };

  return {
    entries,
    fetch: (object, sink) => account.fetch(object, sink),
    ...(options.writable
      ? {
          write: {
            // ⛔ THE BODY IS SPOOLED TO A FILE FIRST, 0600, and deleted whatever happens. The
            //    upload path reserves storage, cuts parts and seals them from a file, and giving it
            //    a socket instead would mean either holding whole uploads in memory or writing a
            //    second upload path — and a second upload path is a second place for "what if the
            //    reservation succeeds and the part fails" to be got right.
            put: async (key, body, size) => {
              await makeDir(options.stagingRoot, { recursive: true, mode: 0o700 });
              const spool = join(options.stagingRoot, randomUUID());
              try {
                await pipeline(body, createWriteStream(spool, { mode: 0o600 }));
                const written = (await stat(spool)).size;
                if (written !== size) {
                  throw new NmtsError(
                    `The upload said ${size} bytes and ${written} arrived. Nothing was stored.`,
                  );
                }
                await storeFile(key, spool);
              } finally {
                await removeFile(spool, { force: true });
              }
            },
            multipart: options.multipart ?? createStaging(options.stagingRoot, storeFile),
            trash: async (object) => {
              await account.trash(`/${object.key}`);
              cachedAt = 0;
            },
          },
        }
      : {}),
  };
}
