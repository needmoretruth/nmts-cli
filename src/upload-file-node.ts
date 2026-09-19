// A file on THIS MACHINE, read a chunk at a time, as a plaintext source.
//
// ⛔ THE SEAM IS `upload-file.ts`'S AND THIS IS THE ONE IMPLEMENTATION THAT NEEDS A DISK. A caller
//    in a browser hands in a `Blob` instead (the SDK's `blobSource`), and everything downstream —
//    the part plan, the sealing, the reservation records — is the same code for both.

import { open } from "node:fs/promises";

import { NmtsError } from "./errors.ts";
import { READ_CHUNK_BYTES, type PlaintextSource } from "./upload-file.ts";

/** Read a file off the disk, a chunk at a time. */
export function fileSource(path: string, size: number): PlaintextSource {
  return {
    size,
    async *read(offset: number, length: number): AsyncIterable<Uint8Array> {
      const handle = await open(path, "r");
      try {
        const buffer = new Uint8Array(Math.min(READ_CHUNK_BYTES, length));
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
