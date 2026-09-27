// Where the pieces of a multipart upload wait until they are one file.
//
// ⛔ ITS OWN MODULE SO IT CAN BE TESTED WITHOUT AN ACCOUNT. What goes wrong here is ordering and
//    integrity -- pieces arrive at the same time and out of order, and one that changed on the way
//    becomes part of a file that opens and is wrong. Both are testable against a real directory
//    with a stub for the one thing that costs money, and neither is testable through a command that
//    starts by opening a session.
//
// ⛔ ONE STORE PER GATEWAY, KEYED BY BUCKET, AND NEVER BOUND TO THE DRIVE AN UPLOAD BEGAN UNDER.
//    A gateway in front of many accounts rebuilds a bucket's drive whenever it asks again whose the
//    bucket is — with a fresh delegation token, or for a different user. The pieces must outlive
//    that, and the file they make must be stored through the drive the bucket has NOW: bound to the
//    first one, every finish after its token expired was refused, and a bucket handed to another
//    user stored that user's uploads in the first user's account. So a drive asks for a `view` of
//    the store (`multipart-view.ts`), handing it its own `store` and `owner`, and an upload
//    remembers which account it began under: asked about by any other, it is gone, and its pieces
//    with it.
//
// ⛔ ONE DIRECTORY PER UPLOAD, 0700, AND EVERY PIECE 0600. The pieces are somebody's plaintext; left
//    in a shared temporary directory under a predictable name they would be readable by every other
//    account on the machine, for as long as the upload takes.
//
// ⛔ ONLY SUCCESS AND ABORT REMOVE THE PIECES. A finish that fails — the store refused, the network
//    dropped — leaves every piece where it was, so the client's retry of the same finish has
//    something to finish. Removing them on failure turned one dropped connection into re-sending
//    the whole file. What was neither finished nor aborted goes once nobody has touched it for
//    `UPLOAD_LIFETIME_MS` — counted from the last piece or attempt, not from when it began, so a
//    slow upload of a large file is not taken away while it is still arriving.

import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { DecodedBody } from "./body.ts";
import type { StoreOutcome, WriteMeta } from "./contract.ts";
import type { WriteCondition } from "./drive-conditions.ts";
import { MAX_UPLOADS_PER_BUCKET } from "./drive-limits.ts";
import type { ObjectChecksum } from "./multipart-assemble.ts";
import { sweepRoot, touch, uploadDirName } from "./multipart-sweep.ts";
import { bucketView, type Finished, type Upload, type UploadBook } from "./multipart-view.ts";
import type { PartChoice } from "./xml-read.ts";

export type { PartChoice } from "./xml-read.ts";
export type { ObjectChecksum } from "./multipart-assemble.ts";

/** What the staging does with a finished file: store it in the drive at that key. */
export type StoreFile = (key: string, path: string, meta: WriteMeta, condition?: WriteCondition) => Promise<StoreOutcome>;

/** How long an upload nobody has touched is kept. S3 leaves this to a lifecycle rule. */
export const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** How long a finished upload is remembered, so a finish sent twice is answered the same twice. */
export const FINISHED_MEMORY_MS = 60 * 60 * 1000;
/** How often a gateway's own store sweeps its directory, and marks the uploads it is working on. */
export const SWEEP_EVERY_MS = 60 * 60 * 1000;

/** One piece, as `ListParts` describes it. */
export interface StagedPart {
  readonly partNumber: number;
  /** The quoted MD5 of the piece's bytes — what S3 answers for a part. */
  readonly etag: string;
  readonly size: number;
  readonly stagedAt: number;
}

/** One upload in progress, as `ListMultipartUploads` describes it. */
export interface StagedUpload {
  readonly uploadId: string;
  readonly key: string;
  readonly meta: WriteMeta;
  readonly initiated: number;
}

/** What a finish carries beyond its part list. */
export interface CompleteOptions {
  /**
   * Called once the upload and the list have been checked and what is left is the store, which can
   * take minutes: the gateway begins its 200 then. Every refusal about the request itself is thrown
   * before it.
   */
  readonly accepted?: (() => void) | undefined;
  /** `If-Match` / `If-None-Match` on the finish, judged where the file is stored. */
  readonly condition?: WriteCondition | undefined;
  /** What the client says the whole object comes to. */
  readonly checksum?: ObjectChecksum | null | undefined;
}

/** A bucket's uploads, as the drive the bucket has now sees them. */
export interface Staging {
  begin(key: string, meta: WriteMeta): Promise<string>;
  /** Stage one piece and answer its tag. `key` must be the one the upload began with. */
  part(uploadId: string, key: string, partNumber: number, body: DecodedBody): Promise<string>;
  /** Join exactly the listed pieces, in the order listed, and store them at the upload's key. */
  complete(uploadId: string, key: string, parts: readonly PartChoice[], options?: CompleteOptions): Promise<StoreOutcome>;
  /** Remove an upload and its pieces. One being finished is waited for first, never cut short. */
  abort(uploadId: string, key: string): Promise<void>;
  /** The pieces staged so far, by part number. */
  parts(uploadId: string, key: string): Promise<readonly StagedPart[]>;
  /** Every upload begun and neither finished nor aborted, by key and then by when it began. */
  uploads(): Promise<readonly StagedUpload[]>;
}

/** What a bucket's drive hands its view of the store, fresh on every request. */
export interface UploadAccount {
  /** Store a finished file through the bucket's drive as it is now. */
  readonly store: StoreFile;
  /**
   * Which account the bucket belongs to now. Absent, or null, means the caller does not say — the
   * account behind the bucket never changes, as it does not for `nmts s3`.
   */
  readonly owner?: (() => Promise<string | null>) | undefined;
  /** The most bytes one object may have. */
  readonly maxObjectBytes?: number | undefined;
}

export interface StagingStore {
  /** The store as one bucket sees it through the drive it has now. */
  view(bucket: string, account: UploadAccount): Staging;
  /** Remove what nobody has touched for `UPLOAD_LIFETIME_MS`: remembered uploads and the directory's own. */
  sweep(): Promise<void>;
  /** Stop sweeping, and wait for every finish in progress. The directory itself is the caller's. */
  close(): Promise<void>;
}

export interface StagingOptions {
  readonly clock?: (() => number) | undefined;
  /**
   * Sweep the directory now and then this often, on a timer that does not keep a process alive.
   * Absent: remembered uploads are swept when one begins, and the directory is left alone.
   */
  readonly sweepEveryMs?: number | undefined;
  /** How many uploads one bucket may have in progress. `MAX_UPLOADS_PER_BUCKET` unless said. */
  readonly maxUploadsPerBucket?: number | undefined;
}

export function createStagingStore(root: string, options: StagingOptions = {}): StagingStore {
  const clock = options.clock ?? Date.now;
  const inFlight = new Map<string, Upload>();
  const finished = new Map<string, Finished>();
  const dirOf = (uploadId: string): string => join(root, uploadDirName(uploadId));
  const busy = (upload: Upload): boolean => upload.finishing !== null || upload.arriving > 0;

  const drop = async (uploadId: string, upload: Upload): Promise<void> => {
    if (inFlight.get(uploadId) === upload) inFlight.delete(uploadId);
    if (upload.finishing === null) await rm(dirOf(uploadId), { recursive: true, force: true });
  };

  const sweepMemory = async (): Promise<void> => {
    const now = clock();
    for (const [uploadId, done] of finished) {
      if (now - done.at > FINISHED_MEMORY_MS) finished.delete(uploadId);
    }
    for (const [uploadId, upload] of inFlight) {
      if (busy(upload) || now - upload.lastActivity <= UPLOAD_LIFETIME_MS) continue;
      await drop(uploadId, upload);
    }
  };

  const book: UploadBook = {
    inFlight,
    finished,
    clock,
    maxPerBucket: options.maxUploadsPerBucket ?? MAX_UPLOADS_PER_BUCKET,
    dirOf,
    drop,
    sweepMemory,
  };

  let sweeping: Promise<void> | null = null;
  const sweep = (): Promise<void> => {
    sweeping ??= (async () => {
      try {
        await sweepMemory();
        // ⚠ What this process is working on is marked first, so another process sharing the
        //   directory never finds it a day old.
        for (const [uploadId, upload] of inFlight) {
          if (busy(upload)) await touch(dirOf(uploadId), Date.now());
        }
        await sweepRoot(root, clock(), UPLOAD_LIFETIME_MS, (uploadId) => inFlight.has(uploadId));
      } finally {
        sweeping = null;
      }
    })();
    return sweeping;
  };

  // ⚠ A TIMER ONLY WHEN ASKED FOR, AND ONE THAT DOES NOT KEEP A PROCESS ALIVE: a gateway asks, a
  //   test driving the staging directly does not.
  let timer: ReturnType<typeof setInterval> | null = null;
  if (options.sweepEveryMs !== undefined) {
    void sweep().catch(() => undefined);
    timer = setInterval(() => void sweep().catch(() => undefined), options.sweepEveryMs);
    timer.unref();
  }

  return {
    view: (bucket, account) => bucketView(book, bucket, account),
    sweep,
    async close(): Promise<void> {
      if (timer !== null) clearInterval(timer);
      timer = null;
      const running = [...inFlight.values()].map((upload) => upload.finishing).filter((f) => f !== null);
      await Promise.allSettled([...running, ...(sweeping === null ? [] : [sweeping])]);
    },
  };
}

/**
 * A staging for one bucket whose account never changes, storing through `store`: what a caller that
 * builds its drive once needs, and nothing more.
 */
export function createStaging(root: string, store: StoreFile, clock: () => number = Date.now): Staging {
  return createStagingStore(root, { clock }).view("", { store });
}
