// Uploads that arrive in pieces.
//
// ⛔ WHY IT IS NOT OPTIONAL. Every S3 client switches to this above a size of its own choosing --
//    rclone's default is 200 MiB -- so a gateway without it works on small files and fails on the
//    large ones, which is the half of a backup that matters most.
//
// ⛔ MEASURED FROM A REAL CLIENT, NOT FROM THE SPECIFICATION. What rclone actually sends is:
//    `POST ?uploads=` to begin · `PUT ?partNumber=N&uploadId=…` for each piece, CONCURRENTLY AND
//    OUT OF ORDER (1, 3, 2 in the capture) · `POST ?uploadId=…` carrying the part list to finish.
//    The out-of-order part is the one a from-the-specification implementation gets wrong, because
//    reading the spec top to bottom suggests a sequence.
//
// ⚠ THE PIECES ARE STAGED, and staging is the caller's business rather than this file's: this
//   module speaks the protocol and the writer it is handed does the filesystem.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { DriveWriter } from "./server.ts";
import { isKeyConflict } from "./same-file.ts";
import { completeUploadXml, initiateUploadXml } from "./xml.ts";

/** S3's own ceiling, and a bound on what one client can stage on this machine. */
export const MAX_PARTS = 10_000;

export interface MultipartContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly bucket: string;
  readonly key: string;
  readonly method: string;
  readonly query: URLSearchParams;
  readonly writer: DriveWriter;
  /** The declared payload hash from the signature, when it was a real digest. */
  readonly payloadHash: string | null;
  readonly fail: (status: number, code: string, message: string) => void;
  readonly log?: ((line: string) => void) | undefined;
}

/** True when this request belongs to a multipart upload rather than a plain object call. */
export function isMultipartRequest(method: string, query: URLSearchParams): boolean {
  return query.has("uploads") || query.has("uploadId") || method === "POST";
}

function send(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "application/xml",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** Answer one multipart request. Returns false when the shape is not one this gateway knows. */
export async function handleMultipart(context: MultipartContext): Promise<boolean> {
  const { method, query, writer, key, res, req } = context;
  const staging = writer.multipart;
  if (staging === undefined) {
    context.fail(501, "NotImplemented", "This gateway does not stage multipart uploads.");
    return true;
  }

  if (method === "POST" && query.has("uploads")) {
    const uploadId = await staging.begin(key);
    send(res, initiateUploadXml(context.bucket, key, uploadId));
    context.log?.(`multipart begin ${key}`);
    return true;
  }

  const uploadId = query.get("uploadId");
  if (uploadId === null) return false;

  if (method === "PUT") {
    const partNumber = Number(query.get("partNumber") ?? "");
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      context.fail(400, "InvalidPart", `A part number must be between 1 and ${MAX_PARTS}.`);
      return true;
    }
    const size = Number(req.headers["content-length"] ?? "");
    if (!Number.isInteger(size) || size < 0) {
      context.fail(411, "MissingContentLength", "This gateway needs the part's size before it starts.");
      return true;
    }
    try {
      const etag = await staging.part(uploadId, partNumber, req, size, context.payloadHash);
      res.writeHead(200, { etag, "content-length": "0" });
      res.end();
    } catch (error) {
      context.fail(400, "InvalidPart", error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (method === "POST") {
    // ⛔ THE PART LIST IN THE BODY IS NOT READ. It carries the tags this gateway itself handed back,
    //    so believing it would be believing our own echo; what the file is made of is what was
    //    staged, in part-number order. Reading it would only add a way to disagree with ourselves.
    await drain(req);
    try {
      const etag = await staging.complete(uploadId);
      send(res, completeUploadXml(context.bucket, key, etag));
      context.log?.(`multipart complete ${key}`);
    } catch (error) {
      // ⛔ A KEY THAT HOLDS A DIFFERENT FILE IS A 409, NOT A 500 — the request was well formed and
      //    the drive declined it. Told 500, a sync tool retries the whole upload forever; told 409
      //    it records a conflict and moves on. The verdict itself is the writer's (`same-file.ts`),
      //    reached only once the pieces are one file, because until then there is nothing to hash.
      if (isKeyConflict(error)) {
        context.fail(409, "InvalidRequest", error instanceof Error ? error.message : String(error));
      } else {
        context.fail(500, "InternalError", error instanceof Error ? error.message : String(error));
      }
    }
    return true;
  }

  if (method === "DELETE") {
    await staging.abort(uploadId);
    res.writeHead(204);
    res.end();
    context.log?.(`multipart abort ${key}`);
    return true;
  }

  return false;
}

async function drain(req: IncomingMessage): Promise<void> {
  for await (const chunk of req) void chunk;
}
