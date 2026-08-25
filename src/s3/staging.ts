// Where the pieces of a multipart upload wait until they are one file.
//
// ⛔ ITS OWN MODULE SO IT CAN BE TESTED WITHOUT AN ACCOUNT. What goes wrong here is ordering and
//    integrity -- pieces arrive at the same time and out of order, and one that changed on the way
//    becomes part of a file that opens and is wrong. Both are testable against a real directory
//    with a stub for the one thing that costs money, and neither is testable through a command that
//    starts by opening a session.
//
// ⛔ ONE DIRECTORY PER RUN, 0700, AND EVERY PIECE 0600. The pieces are somebody's plaintext; left
//    in a shared temporary directory under a predictable name they would be readable by every other
//    account on the machine, for as long as the upload takes.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { NmtsError } from "../errors.ts";

/** What the staging does with a finished file: store it in the drive at that key. */
export type StoreFile = (key: string, path: string) => Promise<void>;

export interface Staging {
  begin(key: string): Promise<string>;
  part(
    uploadId: string,
    partNumber: number,
    body: Readable,
    size: number,
    expectedSha256: string | null,
  ): Promise<string>;
  complete(uploadId: string): Promise<string>;
  abort(uploadId: string): Promise<void>;
}

export function createStaging(root: string, store: StoreFile): Staging {
  const inFlight = new Map<string, { key: string; parts: Set<number> }>();
  const dirOf = (uploadId: string): string => join(root, uploadId);
  const openUpload = (uploadId: string): { key: string; parts: Set<number> } => {
    const upload = inFlight.get(uploadId);
    if (upload === undefined) throw new NmtsError("No upload is in progress with that id.");
    return upload;
  };

  return {
    async begin(key: string): Promise<string> {
      const uploadId = randomUUID();
      await mkdir(dirOf(uploadId), { recursive: true, mode: 0o700 });
      inFlight.set(uploadId, { key, parts: new Set() });
      return uploadId;
    },

    // ⛔ EACH PIECE IS ITS OWN FILE NAMED BY ITS NUMBER, and nothing is appended: a real client
    //    sends them concurrently and out of order (measured from rclone: 1, 3, 2).
    async part(uploadId, partNumber, body, size, expectedSha256): Promise<string> {
      const upload = openUpload(uploadId);
      const path = join(dirOf(uploadId), String(partNumber));
      const digest = createHash("sha256");
      const hashing = new Transform({
        transform(chunk, _encoding, next) {
          digest.update(chunk);
          next(null, chunk);
        },
      });
      await pipeline(body, hashing, createWriteStream(path, { mode: 0o600 }));
      const written = (await stat(path)).size;
      // ⛔ WHAT THE CLIENT SIGNED FOR IS WHAT MUST HAVE ARRIVED. A piece that changed on the way is
      //    the one failure a backup cannot notice later.
      if (expectedSha256 !== null && digest.digest("hex") !== expectedSha256) {
        await rm(path, { force: true });
        throw new NmtsError("That part's bytes do not hash to what the request declared.");
      }
      if (written !== size) {
        await rm(path, { force: true });
        throw new NmtsError(`The part said ${size} bytes and ${written} arrived.`);
      }
      upload.parts.add(partNumber);
      return `"${partNumber.toString(16).padStart(32, "0")}-1"`;
    },

    async complete(uploadId: string): Promise<string> {
      const upload = openUpload(uploadId);
      const numbers = [...upload.parts].sort((a, b) => a - b);
      if (numbers.length === 0) throw new NmtsError("That upload has no parts to finish.");
      const whole = join(dirOf(uploadId), "whole");
      const out = createWriteStream(whole, { mode: 0o600 });
      try {
        for (const number of numbers) {
          await pipeline(createReadStream(join(dirOf(uploadId), String(number))), out, { end: false });
        }
        await new Promise<void>((resolve) => out.end(resolve));
        await store(upload.key, whole);
      } finally {
        inFlight.delete(uploadId);
        await rm(dirOf(uploadId), { recursive: true, force: true });
      }
      return `"${uploadId.replace(/-/g, "").slice(0, 32)}-${numbers.length}"`;
    },

    async abort(uploadId: string): Promise<void> {
      inFlight.delete(uploadId);
      await rm(dirOf(uploadId), { recursive: true, force: true });
    },
  };
}
