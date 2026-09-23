// The two doors a DOWNLOAD needs, answered for a test: the storage network's blobs, and the soft
// delete that takes a file off the drive.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-drive.ts`, and
//    that file is two lines under the gate. The seam is the one the product draws — these two are
//    the only doors in the suite that carry BYTES rather than JSON.
//
// ⛔ THE BLOBS ARE SERVED UNDER THE AGGREGATOR'S PATH, which is the same `/v1/blobs/<id>` the real
//    aggregators answer, so a test points `NMTS_AGGREGATOR` at this server and the product's own
//    reader runs unchanged. Nothing here decrypts or checks anything: what a test proves is that
//    the tool refuses or accepts what an aggregator hands it, so the fake must be able to hand over
//    exactly what it was given.
//
// ⛔ AND THE SOFT DELETE IS RECORDED RATHER THAN SWALLOWED. `setTrashed` treats 404 as "already in
//    that state", so a fake with no route at all lets an overwrite pass while the server is never
//    told — the one failure this door exists to catch.

import type { IncomingMessage, ServerResponse } from "node:http";

export interface BytesState {
  /** Sealed part bytes by blob id, as an aggregator holds them. */
  blobs: Map<string, Uint8Array>;
  /** Every item id the tool asked the server to put in the trash, in order. */
  trashed: string[];
}

export const bytesState: BytesState = { blobs: new Map<string, Uint8Array>(), trashed: [] };

export function resetBytes(): void {
  bytesState.blobs = new Map<string, Uint8Array>();
  bytesState.trashed = [];
}

/** Answer the request if it is one of the two doors; say whether it was. */
export function serveBytes(
  method: string,
  url: string,
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (method === "GET" && url.startsWith("/v1/blobs/")) {
    const id = decodeURIComponent(url.slice("/v1/blobs/".length).replace(/^by-quilt-patch-id\//, ""));
    const bytes = bytesState.blobs.get(id);
    if (bytes === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such blob" } }));
      return true;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from(bytes));
    return true;
  }
  if (method === "DELETE" && /^\/v1\/items\/[^/]+$/.test(url)) {
    bytesState.trashed.push(decodeURIComponent(url.slice("/v1/items/".length)));
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
