// What an upload's headers promise about its body, read before the first byte of it: the framing,
// the object's size, and every digest and checksum the bytes will be held to. One of the parts of
// `body.ts`; only it and its other parts import this.
//
// ⚠ WHAT DECIDES THE FRAMING IS THE SIGNED PAYLOAD HASH, not `content-encoding`. The hash is inside
//   the signature and says exactly one thing; `content-encoding` is often unsigned and may list
//   several codings. A body that says `aws-chunked` while the signature declares a plain payload is
//   refused, because reading it either way would be guessing which half of the request lied.

import type { IncomingMessage } from "node:http";

import { algorithmOfHeader, algorithmOfName, parseChecksumValue, type ChecksumAlgorithm } from "./checksum.ts";
import {
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
  UNSIGNED_PAYLOAD,
  type SigningContext,
  type VerifiedAgainst,
} from "./sigv4.ts";

/** Why a body cannot be used, as the S3 error a client expects. */
export class BodyRefusal extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BodyRefusal";
    this.status = status;
    this.code = code;
  }
}

export type Framing = "plain" | "signed" | "signed-trailer" | "unsigned-trailer";

/** Everything the headers promised, read before the first byte of the body. */
export interface Plan {
  readonly framing: Framing;
  readonly size: number;
  /** The hex SHA-256 a plain body was signed with; null for `UNSIGNED-PAYLOAD` and framed bodies. */
  readonly payloadDigest: string | null;
  readonly contentMd5: Buffer | null;
  /** `x-amz-checksum-*` values that arrived as headers. */
  readonly headerChecksums: ReadonlyMap<ChecksumAlgorithm, Buffer>;
  /** The checksums `x-amz-trailer` says will follow the last chunk. */
  readonly trailers: readonly ChecksumAlgorithm[];
  readonly signing: SigningContext;
}

export function invalid(message: string): BodyRefusal {
  return new BodyRefusal(400, "InvalidRequest", message);
}

export function incomplete(message: string): BodyRefusal {
  return new BodyRefusal(400, "IncompleteBody", message);
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw.join(",") : raw;
}

/** A declared length: the number, undefined when absent, null when it is not a length. */
function lengthOf(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,16}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

function framingOf(payloadHash: string): Framing | null {
  if (/^[0-9a-f]{64}$/.test(payloadHash) || payloadHash === UNSIGNED_PAYLOAD) return "plain";
  if (payloadHash === STREAMING_PAYLOAD) return "signed";
  if (payloadHash === STREAMING_PAYLOAD_TRAILER) return "signed-trailer";
  if (payloadHash === STREAMING_UNSIGNED_PAYLOAD_TRAILER) return "unsigned-trailer";
  return null;
}

/** Read every promise the headers make, or say which one cannot be kept. */
export function planOf(
  req: IncomingMessage,
  verdict: Extract<VerifiedAgainst, { ok: true }>,
  /** `x-amz-checksum-*` headers are the object's, not this body's, and are not held against it. */
  checksumsDescribeObject = false,
): Plan | BodyRefusal {
  const framing = framingOf(verdict.payloadHash);
  if (framing === null) {
    return invalid("x-amz-content-sha256 is not a hex SHA-256, UNSIGNED-PAYLOAD or one of the STREAMING- values");
  }

  const encodings = (headerOf(req, "content-encoding") ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (framing === "plain" && encodings.includes("aws-chunked")) {
    return invalid("content-encoding says aws-chunked and x-amz-content-sha256 declares a plain payload");
  }

  let size: number;
  if (framing === "plain") {
    const length = lengthOf(headerOf(req, "content-length"));
    const decoded = lengthOf(headerOf(req, "x-amz-decoded-content-length"));
    if (length === null || decoded === null) return invalid("a length header is not a whole number of bytes");
    // ⛔ TWO LENGTHS THAT DISAGREE ARE REFUSED, NOT RESOLVED. A plain body has one length; a request
    //    that states two different ones has lied in one of them, and taking either would be judging
    //    the bytes against a number the client may not have meant.
    if (length !== undefined && decoded !== undefined && length !== decoded) {
      return invalid("Content-Length and x-amz-decoded-content-length disagree on a body that is not aws-chunked");
    }
    const declared = length ?? decoded;
    if (declared === undefined) {
      return new BodyRefusal(411, "MissingContentLength", "The upload has no Content-Length.");
    }
    size = declared;
  } else {
    // ⛔ REQUIRED, AS S3 REQUIRES IT. `content-length` of a framed body counts the framing, so
    //    without this the object's size is unknown until the last chunk -- and the one check that
    //    catches a body cut short at a chunk boundary is the count against it.
    const decoded = lengthOf(headerOf(req, "x-amz-decoded-content-length"));
    if (decoded === null) return invalid("x-amz-decoded-content-length is not a whole number of bytes");
    if (decoded === undefined) {
      return new BodyRefusal(
        411,
        "MissingContentLength",
        "An aws-chunked upload needs x-amz-decoded-content-length.",
      );
    }
    size = decoded;
  }

  let contentMd5: Buffer | null = null;
  const md5 = headerOf(req, "content-md5");
  if (md5 !== undefined) {
    const trimmed = md5.trim();
    const bytes = /^[A-Za-z0-9+/]{22}==$/.test(trimmed) ? Buffer.from(trimmed, "base64") : null;
    if (bytes === null || bytes.length !== 16) {
      return new BodyRefusal(400, "InvalidDigest", "Content-MD5 is not the base64 of an MD5 digest.");
    }
    contentMd5 = bytes;
  }

  // ⛔ AN UNKNOWN CHECKSUM IS REFUSED, NOT SKIPPED. A client that sent one believes it is being
  //    checked; passing the upload would be telling it so.
  const headerChecksums = new Map<ChecksumAlgorithm, Buffer>();
  for (const [name, raw] of Object.entries(req.headers)) {
    if (!name.startsWith("x-amz-checksum-")) continue;
    const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
    const suffix = name.slice("x-amz-checksum-".length);
    if (suffix === "type" || suffix === "mode") continue;
    if (checksumsDescribeObject) continue;
    if (suffix === "algorithm") {
      if (algorithmOfName(value) === null) return invalid(`unknown checksum algorithm: ${value}`);
      continue;
    }
    const algorithm = algorithmOfHeader(name);
    if (algorithm === null) return invalid(`unknown checksum algorithm: ${name}`);
    const parsed = parseChecksumValue(algorithm, value);
    if (parsed === null) return invalid(`${name} is not a ${algorithm} value`);
    headerChecksums.set(algorithm, parsed);
  }
  const sdkAlgorithm = headerOf(req, "x-amz-sdk-checksum-algorithm");
  if (sdkAlgorithm !== undefined && algorithmOfName(sdkAlgorithm) === null) {
    return invalid(`unknown checksum algorithm: ${sdkAlgorithm}`);
  }

  const trailers: ChecksumAlgorithm[] = [];
  for (const raw of (headerOf(req, "x-amz-trailer") ?? "").split(",")) {
    const name = raw.trim().toLowerCase();
    if (name.length === 0) continue;
    const algorithm = algorithmOfHeader(name);
    if (algorithm === null) return invalid(`x-amz-trailer names ${name}, which is not a checksum S3 knows`);
    if (trailers.includes(algorithm) || headerChecksums.has(algorithm)) {
      return invalid(`${name} is declared twice`);
    }
    trailers.push(algorithm);
  }
  if (trailers.length > 0 && (framing === "plain" || framing === "signed")) {
    return invalid("x-amz-trailer names a trailer and x-amz-content-sha256 declares a payload without one");
  }

  return {
    framing,
    size,
    payloadDigest: /^[0-9a-f]{64}$/.test(verdict.payloadHash) ? verdict.payloadHash : null,
    contentMd5,
    headerChecksums,
    trailers,
    signing: verdict.signing,
  };
}
