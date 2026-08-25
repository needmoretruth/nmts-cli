// The gateway itself: an S3 request in, this account's drive out.
//
// ⛔ LOOPBACK ONLY, AND NO OPTION TO CHANGE IT. The machine running this already holds the account
//    code, and one signature is all that stands between a request and every file in the account.
//    Bound to an address other people can reach, that one signature becomes the whole lock on the
//    account -- and the key it checks was printed on somebody's terminal. This is the same call the
//    rest of the system made on 2026-08-20 when every container port was pulled back to loopback.
//
// ⛔ WHAT IS NOT ANSWERED IS REFUSED, LOUDLY. An S3 client that asks for something this gateway does
//    not do gets 501 and a sentence naming what it does do. The alternative -- answering an empty
//    listing, or a 200 with nothing behind it -- is how a backup tool reports success over a backup
//    that never happened.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { Readable } from "node:stream";

import type { PlaintextSink } from "../download-sink.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { BUCKET, listObjects, objectsOf, folderPrefixesOf, MAX_KEYS_LIMIT, type DriveObject } from "./listing.ts";
import { responseSink } from "./response-sink.ts";
import {
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  verifySignature,
  type GatewayCredential,
} from "./sigv4.ts";
import { errorXml, listBucketsXml, listObjectsXml } from "./xml.ts";

/** Where the drive is served. Loopback, always — see the note above. */
export const BIND_ADDRESS = "127.0.0.1";

export interface DriveSource {
  /** The account's live file list. Called per request; the caller decides what to cache. */
  entries(): Promise<readonly ManifestEntry[]>;
  /**
   * Fetch, decrypt and deliver one file into the sink.
   *
   * ⛔ INJECTED RATHER THAN IMPORTED so this server can be driven by a real S3 client in a test
   *    without an account, a network and somebody's credits. A gateway whose only test is an
   *    end-to-end one is a gateway whose refusals are never tested at all.
   */
  fetch(object: DriveObject, sink: PlaintextSink): Promise<void>;
  /**
   * How to change the drive, when this machine has agreed to spending.
   *
   * ⛔ ABSENT MEANS READ ONLY, AND THAT IS A REFUSAL RATHER THAN A GAP. Uploading spends credits,
   *    which is one of the three things this tool asks a person about once per machine, and a
   *    gateway cannot ask: its stdin is not a terminal and the caller is a program. So the
   *    agreement has to exist beforehand, and where it does not, every write says so.
   */
  readonly write?: DriveWriter;
}

export interface DriveWriter {
  /** Store `body` at this key. `size` is the byte count the client declared. */
  put(key: string, body: Readable, size: number): Promise<void>;
  /** Send one file to the trash, where it stays recoverable for thirty days. */
  trash(object: DriveObject): Promise<void>;
}

export interface GatewayOptions {
  readonly credential: GatewayCredential;
  readonly source: DriveSource;
  /** Called with one line whenever a request is answered, so a person can watch what a tool does. */
  readonly log?: (line: string) => void;
  /** Passed in so a test can hold the clock still. */
  readonly now?: () => number;
}

/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export function newCredential(): GatewayCredential {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const raw = randomBytes(20);
  let id = "NMTS";
  for (const byte of raw) id += letters[byte % letters.length] ?? "A";
  return { accessKeyId: id.slice(0, 20), secretAccessKey: randomBytes(30).toString("base64url") };
}

function fail(res: ServerResponse, status: number, code: string, message: string, resource: string): void {
  const body = errorXml(code, message, resource);
  res.writeHead(status, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
  res.end(body);
}

/** `/drive/photos/a.jpg` → bucket `drive`, key `photos/a.jpg`. */
function splitPath(pathname: string): { bucket: string; key: string } {
  const trimmed = pathname.replace(/^\//, "");
  const at = trimmed.indexOf("/");
  if (at < 0) return { bucket: decodeURIComponent(trimmed), key: "" };
  return { bucket: decodeURIComponent(trimmed.slice(0, at)), key: decodeURIComponent(trimmed.slice(at + 1)) };
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw.join(",") : raw;
}

/** The one sentence a write gets when this machine has not agreed to spending. */
function readOnlyBecause(): string {
  return (
    "This gateway is read only. Uploading spends credits, and this machine has not agreed to " +
    "spending — `nmts consent grant spend`, run by the person whose account this is, is what " +
    "changes that. Nothing was written."
  );
}

function objectHeaders(object: DriveObject): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "last-modified": new Date(object.entry.updatedAt).toUTCString(),
    etag: object.etag,
    "accept-ranges": "none",
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, options: GatewayOptions): Promise<void> {
  const url = req.url ?? "/";
  const at = url.indexOf("?");
  const pathname = at < 0 ? url : url.slice(0, at);
  const query = new URLSearchParams(at < 0 ? "" : url.slice(at + 1));
  const method = (req.method ?? "GET").toUpperCase();

  const verdict = verifySignature(
    { method, url, headers: req.headers },
    options.credential,
    options.now?.() ?? Date.now(),
  );
  if (!verdict.ok) {
    fail(res, verdict.code === "InvalidAccessKeyId" ? 403 : 403, verdict.code, verdict.message, pathname);
    return;
  }

  const { bucket, key } = splitPath(pathname);

  if (pathname === "/" && (method === "GET" || method === "HEAD")) {
    const body = listBucketsXml(BUCKET, new Date(0).toISOString());
    res.writeHead(200, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
    res.end(method === "HEAD" ? undefined : body);
    return;
  }

  if (bucket !== BUCKET) {
    fail(res, 404, "NoSuchBucket", `This gateway serves one bucket, named ${BUCKET}.`, pathname);
    return;
  }

  // ⛔ MEASURED, NOT GUESSED: rclone's first act when copying a file is to create the bucket, and a
  //    refusal here ends the copy before the upload is ever attempted. The bucket exists, so the
  //    honest answer to "make it" is that it is made.
  if (key === "" && method === "PUT") {
    res.writeHead(200, { "content-length": "0" });
    res.end();
    return;
  }

  const entries = await options.source.entries();

  if (key === "" && (method === "GET" || method === "HEAD")) {
    const objects = objectsOf(entries);
    const listing = listObjects(objects, folderPrefixesOf(entries), {
      prefix: query.get("prefix") ?? "",
      delimiter: query.get("delimiter") ?? "",
      maxKeys: Number(query.get("max-keys") ?? MAX_KEYS_LIMIT) || MAX_KEYS_LIMIT,
      after: query.get("continuation-token") ?? query.get("start-after") ?? query.get("marker"),
    });
    const body = listObjectsXml({
      bucket: BUCKET,
      prefix: query.get("prefix") ?? "",
      delimiter: query.get("delimiter") ?? "",
      maxKeys: Number(query.get("max-keys") ?? MAX_KEYS_LIMIT) || MAX_KEYS_LIMIT,
      v2: query.get("list-type") === "2",
      contents: listing.contents,
      commonPrefixes: listing.commonPrefixes,
      truncated: listing.truncated,
      next: listing.next,
      encodingType: query.get("encoding-type"),
    });
    res.writeHead(200, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
    res.end(method === "HEAD" ? undefined : body);
    options.log?.(`${method} list prefix=${query.get("prefix") ?? ""} → ${listing.contents.length} keys`);
    return;
  }

  if (method === "HEAD" || method === "GET") {
    const object = objectsOf(entries).find((o) => o.key === key);
    if (object === undefined) {
      fail(res, 404, "NoSuchKey", "This account's file list has no such file.", pathname);
      return;
    }
    if (method === "HEAD") {
      res.writeHead(200, { ...objectHeaders(object), "content-length": String(object.size) });
      res.end();
      options.log?.(`HEAD ${key}`);
      return;
    }
    if (object.entry.dekWrapped === undefined) {
      fail(res, 500, "InternalError", "That entry has no key in the file list.", pathname);
      return;
    }
    const sink = responseSink(res, { headers: objectHeaders(object) });
    try {
      await options.source.fetch(object, sink);
      options.log?.(`GET ${key} → ${object.size} bytes`);
    } catch (error) {
      await sink.abandon();
      if (!res.headersSent) {
        fail(res, 502, "InternalError", error instanceof Error ? error.message : String(error), pathname);
      }
      options.log?.(`GET ${key} → failed`);
    }
    return;
  }

  const writer = options.source.write;

  if (method === "PUT" && key !== "") {
    if (writer === undefined) {
      fail(res, 501, "NotImplemented", readOnlyBecause(), pathname);
      return;
    }
    const declared = headerOf(req, "x-amz-content-sha256");
    if (declared === STREAMING_PAYLOAD || declared === STREAMING_PAYLOAD_TRAILER) {
      fail(
        res,
        501,
        "NotImplemented",
        "This gateway does not read chunk-signed uploads yet. Tell the client to send the body " +
          "unsigned (the AWS CLI calls this --no-sign-payload on http endpoints; rclone already " +
          "does it).",
        pathname,
      );
      return;
    }
    const length = Number(headerOf(req, "content-length") ?? "");
    if (!Number.isInteger(length) || length < 0) {
      fail(res, 411, "MissingContentLength", "This gateway needs to know the size before it starts.", pathname);
      return;
    }
    // ⛔ AN EXISTING KEY IS A CONFLICT, NOT AN OVERWRITE. This drive never replaces a file: the same
    //    name arrives as a numbered copy, which is a product decision and not this gateway's to
    //    change. Answering 200 while writing "name (2)" would tell a sync tool it had updated a
    //    file it had in fact duplicated, and it would go on duplicating on every run.
    const already = objectsOf(entries).some((o) => o.key === key);
    if (already) {
      fail(
        res,
        409,
        "InvalidRequest",
        "There is already a file at that key, and this drive does not replace files. Delete it " +
          "first — a delete puts it in the trash, where it stays recoverable for thirty days.",
        pathname,
      );
      return;
    }
    try {
      await writer.put(key, req, length);
    } catch (error) {
      fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), pathname);
      return;
    }
    res.writeHead(200, { "content-length": "0" });
    res.end();
    options.log?.(`PUT ${key} → ${length} bytes`);
    return;
  }

  if (method === "DELETE" && key !== "") {
    if (writer === undefined) {
      fail(res, 501, "NotImplemented", readOnlyBecause(), pathname);
      return;
    }
    const object = objectsOf(entries).find((o) => o.key === key);
    if (object === undefined) {
      // S3 answers 204 for a key that is not there, and clients rely on it: a sync that deletes
      // the same key twice must not fail the second time.
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      await writer.trash(object);
    } catch (error) {
      fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), pathname);
      return;
    }
    res.writeHead(204);
    res.end();
    options.log?.(`DELETE ${key} → trash`);
    return;
  }

  // ⛔ MULTIPART IS NAMED RATHER THAN LUMPED IN WITH EVERYTHING ELSE. It is what every client
  //    switches to for a large file, so "not implemented" without the reason reads as a broken
  //    gateway rather than a known edge with a way around it.
  if (method === "POST" || query.has("uploadId") || query.has("uploads")) {
    fail(
      res,
      501,
      "NotImplemented",
      "This gateway does not do multipart uploads yet. Clients switch to them above a size " +
        "threshold — rclone's is --s3-upload-cutoff — so raising that threshold sends the file in " +
        "one request instead.",
      pathname,
    );
    return;
  }

  fail(res, 501, "NotImplemented", `This gateway does not answer ${method} on that address.`, pathname);
}

export function createGateway(options: GatewayOptions): Server {
  return createServer((req, res) => {
    handle(req, res, options).catch((error: unknown) => {
      if (!res.headersSent) {
        fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), req.url ?? "/");
      } else {
        res.destroy();
      }
    });
  });
}
