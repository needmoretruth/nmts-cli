// AWS Signature Version 4, the verifying half.
//
// ⛔ WHY A LOCAL SERVER CHECKS SIGNATURES AT ALL. This gateway listens on the loopback address of a
//    machine that already holds an account code, and a request that reaches it can upload, read and
//    delete that account's files. "It is only local" is not an argument: every other program on the
//    machine, and every page a browser on it loads, can also reach 127.0.0.1. The signature is the
//    one thing that separates the tool the person started from everything else running as them.
//
// ⛔ WHAT IS DELIBERATELY NOT HERE. The body is not hashed here. The signature covers a payload hash
//    the client DECLARES in `x-amz-content-sha256`, and whether the bytes that follow really hash to
//    that value can only be known once they have all arrived. This module returns the declared value
//    and the caller enforces it while streaming -- doing it here would mean holding whole uploads in
//    memory before a single byte reached the storage network.
//
// The rules implemented are S3's, which differ from the generic SigV4 ones in one way that matters:
// the canonical path is the request path EXACTLY as it arrived, neither normalised nor re-encoded.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** How far a request's own timestamp may sit from ours before it is refused. AWS uses the same. */
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

/** The literals a client may put in `x-amz-content-sha256` instead of a hex digest. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const STREAMING_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export const STREAMING_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";

export interface IncomingRequest {
  readonly method: string;
  /** Raw request target, path and query together, exactly as it came off the wire. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface GatewayCredential {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export type Verified =
  | { readonly ok: true; readonly payloadHash: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

function refuse(code: string, message: string): Verified {
  return { ok: false, code, message };
}

function headerValue(
  headers: IncomingRequest["headers"],
  name: string,
): string | undefined {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw.join(",") : String(raw);
}

/**
 * RFC 3986 encoding, which is what SigV4 means by "URI-encode".
 *
 * ⚠ `encodeURIComponent` leaves `!'()*` alone and AWS does not, so those four are finished by hand.
 * A query string that contains one of them and is encoded the JavaScript way produces a different
 * canonical request from the client's, and the request is refused for no reason a person can see.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `k=v&k2=v2` in the order AWS wants: encoded, sorted by key and then by value. */
export function canonicalQuery(rawQuery: string): string {
  if (rawQuery.length === 0) return "";
  const pairs: Array<[string, string]> = [];
  for (const part of rawQuery.split("&")) {
    if (part.length === 0) continue;
    const at = part.indexOf("=");
    const key = at < 0 ? part : part.slice(0, at);
    const value = at < 0 ? "" : part.slice(at + 1);
    pairs.push([uriEncode(decodeURIComponent(key)), uriEncode(decodeURIComponent(value))]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

interface AuthorizationParts {
  readonly accessKeyId: string;
  readonly date: string;
  readonly region: string;
  readonly service: string;
  readonly signedHeaders: readonly string[];
  readonly signature: string;
}

/** Pull apart `AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`. */
export function parseAuthorization(header: string | undefined): AuthorizationParts | null {
  if (header === undefined || !header.startsWith("AWS4-HMAC-SHA256 ")) return null;
  const fields = new Map<string, string>();
  for (const part of header.slice("AWS4-HMAC-SHA256 ".length).split(",")) {
    const at = part.indexOf("=");
    if (at < 0) return null;
    fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const credential = fields.get("Credential");
  const signedHeaders = fields.get("SignedHeaders");
  const signature = fields.get("Signature");
  if (credential === undefined || signedHeaders === undefined || signature === undefined) return null;
  const scope = credential.split("/");
  if (scope.length !== 5 || scope[4] !== "aws4_request") return null;
  const [accessKeyId, date, region, service] = scope;
  if (accessKeyId === undefined || date === undefined || region === undefined || service === undefined) {
    return null;
  }
  return {
    accessKeyId,
    date,
    region,
    service,
    signedHeaders: signedHeaders.split(";").filter((h) => h.length > 0),
    signature,
  };
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

/** `20260824T232759Z` → epoch milliseconds, or null if it is not that shape. */
export function amzDateToMs(stamp: string | undefined): number | null {
  if (stamp === undefined) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (m === null) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

/**
 * Rebuild the string the client signed and check that the signature matches.
 *
 * The clock is passed in rather than read here: a test that cannot choose "now" cannot check the
 * skew rule at all, and that rule is the one that stops a captured request being replayed tomorrow.
 */
export function verifySignature(
  request: IncomingRequest,
  credential: GatewayCredential,
  now: number,
): Verified {
  const auth = parseAuthorization(headerValue(request.headers, "authorization"));
  if (auth === null) return refuse("AccessDenied", "no AWS Signature Version 4 authorization header");
  if (auth.accessKeyId !== credential.accessKeyId) {
    return refuse("InvalidAccessKeyId", "that access key is not the one this gateway printed");
  }

  const stamp = headerValue(request.headers, "x-amz-date");
  const signedAt = amzDateToMs(stamp);
  if (signedAt === null) return refuse("AccessDenied", "missing or malformed x-amz-date");
  if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) {
    return refuse("RequestTimeTooSkewed", "the request's own timestamp is too far from this clock");
  }
  if (stamp !== undefined && !stamp.startsWith(auth.date)) {
    return refuse("AccessDenied", "the signature's date does not match x-amz-date");
  }

  const payloadHash = headerValue(request.headers, "x-amz-content-sha256");
  if (payloadHash === undefined) {
    return refuse("AccessDenied", "missing x-amz-content-sha256");
  }

  const canonicalHeaders: string[] = [];
  for (const name of auth.signedHeaders) {
    const value = headerValue(request.headers, name);
    if (value === undefined) {
      return refuse("AccessDenied", `the signature covers a header that is not here: ${name}`);
    }
    canonicalHeaders.push(`${name}:${value.trim().replace(/\s+/g, " ")}\n`);
  }

  const at = request.url.indexOf("?");
  const path = at < 0 ? request.url : request.url.slice(0, at);
  const query = at < 0 ? "" : request.url.slice(at + 1);
  const canonicalRequest = [
    request.method.toUpperCase(),
    path,
    canonicalQuery(query),
    canonicalHeaders.join(""),
    auth.signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${auth.date}/${auth.region}/${auth.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const expected = createHmac(
    "sha256",
    signingKey(credential.secretAccessKey, auth.date, auth.region, auth.service),
  )
    .update(stringToSign)
    .digest("hex");

  const given = Buffer.from(auth.signature, "utf8");
  const mine = Buffer.from(expected, "utf8");
  if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
    return refuse("SignatureDoesNotMatch", "the signature does not match what was signed");
  }
  return { ok: true, payloadHash };
}
