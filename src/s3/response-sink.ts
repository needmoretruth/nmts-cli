// Where a decrypted file goes when the reader is an HTTP client rather than a disk.
//
// ⛔ THE INTEGRITY PROMISE IS DIFFERENT HERE, AND THE DIFFERENCE IS SAID OUT LOUD. Every other sink
//    in this tool makes a file visible only after the whole of it has been proved. A response
//    cannot do that: S3 clients want the body to start arriving immediately, and the status line
//    and length go out before the first byte. So bytes reach the client as they are decrypted, and
//    the check at the end can no longer withhold them.
//
// ⛔ WHAT IT DOES INSTEAD: if anything fails after the response began, the connection is DESTROYED
//    rather than ended. A client that was promised `Content-Length` bytes and gets fewer, with no
//    clean end, reports a failed transfer — which is the truth. Ending the response normally would
//    hand over a short file that every client would file away as complete.
//
// ⚠ A RANGE IS CUT FROM THE PLAINTEXT AS IT PASSES. The sink names its window, so the reader can
//   leave out the stored parts that end before it (`skip` moves this sink's count past them) and
//   start at the part the window begins in; inside that part it still reads from the part's first
//   chunk, because the sequential opener is the only one this tool's engine surface has. The write
//   that carries the window's last byte ends the response and refuses, which stops the reader
//   rather than fetching the rest of the file for nobody. ⚠ The whole-file digest is reached only
//   by a range read from the file's first byte to its last: every part is still authenticated,
//   and put in its place by its sealed header, but any other range is not checked against the
//   file's recorded hash.

import type { ServerResponse } from "node:http";

import type { PlaintextSink } from "../download-sink.ts";
import { NmtsError } from "../errors.ts";

export interface ResponseSinkOptions {
  /** Headers to send with the 200 or 206, once the size is known. */
  readonly headers: Readonly<Record<string, string>>;
  /** Only these bytes, inclusive, answered 206. Null or absent answers the whole file. */
  readonly window?: { readonly start: number; readonly end: number } | null | undefined;
}

/** A response sink, and whether a range it was cutting has been delivered in full. */
export interface ResponseSink extends PlaintextSink {
  /** True once every byte of the window went out and the response was ended. */
  windowDelivered(): boolean;
}

/** Thrown into the reader once the window is out: the rest of the file is not wanted. */
class WindowDelivered extends Error {
  constructor() {
    super("Every byte of the requested range was delivered.");
    this.name = "WindowDelivered";
  }
}

/** A sink that writes one file into an HTTP response and never leaves a short body looking whole. */
export function responseSink(res: ServerResponse, options: ResponseSinkOptions): ResponseSink {
  const window = options.window ?? null;
  let started = false;
  let delivered = false;
  let size = 0;
  let offset = 0;

  const send = (bytes: Uint8Array): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      res.write(bytes, (error) => (error === null || error === undefined ? resolve() : reject(error)));
    });

  return {
    expect(total: number): void {
      size = total;
      if (window === null) {
        res.writeHead(200, { ...options.headers, "content-length": String(total) });
      } else {
        if (window.end >= total) throw new NmtsError("The stored file is shorter than its listing says.");
        res.writeHead(206, {
          ...options.headers,
          "content-range": `bytes ${window.start}-${window.end}/${total}`,
          "content-length": String(window.end - window.start + 1),
        });
      }
      started = true;
    },
    async write(bytes: Uint8Array): Promise<void> {
      if (delivered) throw new WindowDelivered();
      if (res.writableEnded || res.destroyed) return;
      if (window === null) {
        await send(bytes);
        return;
      }
      const from = offset;
      offset += bytes.length;
      const lo = Math.max(from, window.start);
      const hi = Math.min(offset, window.end + 1);
      if (lo < hi) await send(bytes.subarray(lo - from, hi - from));
      // A window that runs to the file's own end is left to `commit`, so the reader's checks still
      // run before the response ends; one that stops short ends here and stops the reader.
      if (offset > window.end && offset < size) {
        delivered = true;
        await new Promise<void>((resolve) => res.end(resolve));
        throw new WindowDelivered();
      }
    },
    async commit(): Promise<boolean> {
      if (res.destroyed) return false;
      if (!res.writableEnded) await new Promise<void>((resolve) => res.end(resolve));
      return true;
    },
    async abandon(): Promise<void> {
      // Nothing was written yet: the caller can still answer with a proper S3 error document.
      if (!started || delivered) return;
      res.destroy();
    },
    window,
    skip(bytes: number): void {
      // ⛔ ONLY BYTES THE CLIENT DID NOT ASK FOR. Skipping into the window would send a body that
      //    is short by exactly what was skipped, under a length that promised it.
      if (window === null || offset + bytes > window.start) {
        throw new NmtsError("The reader left out bytes this range needs.");
      }
      offset += bytes;
    },
    windowDelivered: () => delivered,
  };
}
