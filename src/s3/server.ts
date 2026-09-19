// The gateway itself: an S3 request in, this account's drive out.
//
// ⛔ LOOPBACK ONLY, AND NO OPTION TO CHANGE IT. The machine running this already holds the NMTS
//    key, and one signature is all that stands between a request and every file in the account.
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
import { listObjects, objectsOf, folderPrefixesOf, MAX_KEYS_LIMIT, type DriveObject } from "./listing.ts";
import { handleMultipart, isMultipartRequest } from "./multipart.ts";
import { responseSink } from "./response-sink.ts";
import { isKeyConflict } from "./same-file.ts";
import {
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  verifyAgainst,
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
  /**
   * Staging for uploads that arrive in pieces. Absent means this gateway refuses them.
   *
   * ⚠ Separate from `put` because the pieces have to land somewhere before they are one file, and
   *   where that is belongs to whoever is running this rather than to the protocol.
   */
  readonly multipart?: {
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
  };
}

export interface GatewayOptions {
  /**
   * Every pair that may sign a request here, each optionally held to named buckets.
   *
   * ⛔ A LIST RATHER THAN ONE PAIR BECAUSE A BUCKET IS AN ACCOUNT. `nmts s3` makes one pair for one
   *    drive; a business serving many of its users' accounts hands each of them a pair of their
   *    own, and the restriction on the pair is what stops one customer reading another's bucket.
   */
  readonly credentials: readonly GatewayCredential[];
  /**
   * Which drive answers to this bucket name, or null when none does.
   *
   * ⛔ THE GATEWAY DOES NOT KNOW WHAT A BUCKET IS. It was one name and one drive for as long as the
   *    only caller was the command-line tool; asked by a business's server it is a lookup that
   *    server does, and one it may do differently per name. What must not change is that a name
   *    this resolver refuses looks exactly like a name the caller may not touch (see below).
   */
  readonly bucketOf: (name: string) => DriveSource | null | Promise<DriveSource | null>;
  /**
   * The names `ListBuckets` answers with, before the signing pair's own restriction is applied.
   *
   * ⚠ ABSENT IS A REAL ANSWER RATHER THAN A GAP. A gateway in front of a business's own lookup
   *   cannot enumerate its customers, so what it can honestly name is what the presented pair is
   *   held to — and an unrestricted pair on such a gateway is told nothing, which is true.
   */
  readonly bucketNames?: () => readonly string[] | Promise<readonly string[]>;
  /** Called with one line whenever a request is answered, so a person can watch what a tool does. */
  readonly log?: (line: string) => void;
  /** Passed in so a test can hold the clock still. */
  readonly now?: () => number;
  /**
   * The sentence a write gets from a read-only drive. `nmts s3` says what a person runs on this
   * machine to allow spending; a gateway somebody else runs has a different way in, and says its own.
   */
  readonly readOnlyBecause?: string | undefined;
}

/**
 * What a caller signed with a pair it may not use here.
 *
 * ⛔ THE SAME ANSWER WHETHER OR NOT THE BUCKET EXISTS, which is why the restriction is checked
 *    before the resolver is asked. Answering `NoSuchBucket` for a name the caller may not touch
 *    would turn this gateway into a way of asking "does this business have a customer called…",
 *    one guess at a time.
 */
const NOT_YOURS = "That access key may not use that bucket.";

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

/** The one sentence a write gets from `nmts s3` when this machine has not agreed to spending. */
function readOnlyOnThisMachine(): string {
  return (
    "This gateway is read only. Uploading spends credits, and this machine has not agreed to " +
    "spending — `nmts consent grant spend`, run by the person whose account this is, is what " +
    "changes that. Nothing was written."
  );
}

/** Whether the pair that signed is allowed anywhere near this bucket name. */
function mayTouch(credential: GatewayCredential, bucket: string): boolean {
  const only = credential.buckets;
  return only === undefined || only.includes(bucket);
}

/** What `ListBuckets` says: what the gateway can name, narrowed to what this pair may touch. */
async function bucketsFor(
  options: GatewayOptions,
  credential: GatewayCredential,
): Promise<readonly string[]> {
  const only = credential.buckets;
  if (options.bucketNames === undefined) return only ?? [];
  const named = await options.bucketNames();
  return only === undefined ? named : named.filter((name) => only.includes(name));
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

  const verdict = verifyAgainst(
    { method, url, headers: req.headers },
    options.credentials,
    options.now?.() ?? Date.now(),
  );
  if (!verdict.ok) {
    fail(res, 403, verdict.code, verdict.message, pathname);
    return;
  }
  const credential = verdict.credential;

  const { bucket, key } = splitPath(pathname);

  if (pathname === "/" && (method === "GET" || method === "HEAD")) {
    const body = listBucketsXml(await bucketsFor(options, credential), new Date(0).toISOString());
    res.writeHead(200, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
    res.end(method === "HEAD" ? undefined : body);
    return;
  }

  if (!mayTouch(credential, bucket)) {
    fail(res, 403, "AccessDenied", NOT_YOURS, pathname);
    return;
  }

  const source = await options.bucketOf(bucket);
  if (source === null) {
    fail(res, 404, "NoSuchBucket", `No bucket named ${bucket} is served here.`, pathname);
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

  const entries = await source.entries();

  if (key === "" && (method === "GET" || method === "HEAD")) {
    const objects = objectsOf(entries);
    const listing = listObjects(objects, folderPrefixesOf(entries), {
      prefix: query.get("prefix") ?? "",
      delimiter: query.get("delimiter") ?? "",
      maxKeys: Number(query.get("max-keys") ?? MAX_KEYS_LIMIT) || MAX_KEYS_LIMIT,
      after: query.get("continuation-token") ?? query.get("start-after") ?? query.get("marker"),
    });
    const body = listObjectsXml({
      bucket,
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
      await source.fetch(object, sink);
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

  const writer = source.write;

  // ⛔ WHETHER A TAKEN KEY IS A CONFLICT IS NOT DECIDED HERE.
  //    It used to be, on the strength of the NAME alone, and both upload paths carried their own
  //    copy of that check. The question is now about CONTENT — is the file arriving the file
  //    already there — and it cannot be answered until the bytes have arrived, so it is answered
  //    once, by the writer, at the point both paths meet. What reaches this layer is the verdict:
  //    a writer that returns normally means the key now holds these bytes (whether it had to send
  //    them or they were already there), and one that throws a conflict means something else is at
  //    that key. ⭐ The status matters: 409 is a request the drive declined, 500 is a fault of ours.
  const refuseConflict = (error: unknown): void => {
    fail(res, 409, "InvalidRequest", error instanceof Error ? error.message : String(error), pathname);
  };

  if (isMultipartRequest(method, query) && key !== "") {
    if (writer === undefined) {
      fail(res, 501, "NotImplemented", options.readOnlyBecause ?? readOnlyOnThisMachine(), pathname);
      return;
    }
    const handled = await handleMultipart({
      req,
      res,
      bucket,
      key,
      method,
      query,
      writer,
      payloadHash: /^[0-9a-f]{64}$/.test(verdict.payloadHash) ? verdict.payloadHash : null,
      fail: (status, code, message) => fail(res, status, code, message, pathname),
      ...(options.log === undefined ? {} : { log: options.log }),
    });
    if (handled) return;
  }

  if (method === "PUT" && key !== "") {
    if (writer === undefined) {
      fail(res, 501, "NotImplemented", options.readOnlyBecause ?? readOnlyOnThisMachine(), pathname);
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
    try {
      await writer.put(key, req, length);
    } catch (error) {
      if (isKeyConflict(error)) {
        refuseConflict(error);
        return;
      }
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
      fail(res, 501, "NotImplemented", options.readOnlyBecause ?? readOnlyOnThisMachine(), pathname);
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

  fail(res, 501, "NotImplemented", `This gateway does not answer ${method} on that address.`, pathname);
}

/** A plain Node request handler, so this can be mounted in somebody else's server. */
export type GatewayHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently.
 */
export function gatewayHandler(options: GatewayOptions): GatewayHandler {
  return (req, res) => {
    handle(req, res, options).catch((error: unknown) => {
      if (!res.headersSent) {
        fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), req.url ?? "/");
      } else {
        res.destroy();
      }
    });
  };
}

export function createGateway(options: GatewayOptions): Server {
  return createServer(gatewayHandler(options));
}
