// AWS Signature Version 4, the verifying half.
//
// ⛔ WHY A LOCAL SERVER CHECKS SIGNATURES AT ALL. This gateway listens on the loopback address of a
//    machine that already holds an NMTS key, and a request that reaches it can upload, read and
//    delete that account's files. "It is only local" is not an argument: every other program on the
//    machine, and every page a browser on it loads, can also reach 127.0.0.1. The signature is the
//    one thing that separates the tool the person started from everything else running as them.
//
// ⛔ TWO WAYS TO CARRY ONE SIGNATURE. An `Authorization` header, which is what every S3 client
//    sends, and a presigned URL (`X-Amz-Algorithm`, `X-Amz-Credential`, … in the query), which is
//    what a client hands to somebody who has no key: a browser, `curl`, a download link. Both are
//    checked by the same code against the same pairs with the same comparison; what differs is only
//    where the parts are read from, and that a presigned URL carries its own lifetime. The query
//    form is read in `sigv4-presigned.ts`; what both forms share is in `sigv4-canonical.ts`.
//
// ⛔ WHAT IS DELIBERATELY NOT HERE. The body is not read here. The signature covers a payload hash
//    the client DECLARES in `x-amz-content-sha256`, and whether the bytes that follow really hash to
//    that value -- or, for a chunk-signed body, whether each chunk's signature holds -- can only be
//    known once they have arrived. This module checks that the declared value is one S3 allows and
//    hands `body.ts` what it needs to continue the check while the bytes stream: the signing key,
//    the scope, the timestamp and the seed signature. Doing it here would mean holding whole uploads
//    in memory before a single byte reached the storage network.
//
// The rules implemented are S3's, which differ from the generic SigV4 ones in one way that matters:
// the canonical path is the request path EXACTLY as it arrived, neither normalised nor re-encoded.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  amzDateToMs,
  canonicalOf,
  headerValue,
  isPayloadHash,
  parseCredentialScope,
  queryParts,
  refuse,
  scopeProblem,
  signingKey,
  unsignedHeaders,
  type AuthorizationParts,
  type IncomingRequest,
  type Presented,
  type QueryPart,
  type Refusal,
} from "./sigv4-canonical.ts";
import { isPresigned, presentedFromQuery } from "./sigv4-presigned.ts";

export {
  amzDateToMs,
  canonicalQuery,
  isPayloadHash,
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
  UNSIGNED_PAYLOAD,
} from "./sigv4-canonical.ts";
export type { IncomingRequest } from "./sigv4-canonical.ts";
export { MAX_PRESIGNED_EXPIRY_SECONDS } from "./sigv4-presigned.ts";

/** How far a request's own timestamp may sit from ours before it is refused. AWS uses the same. */
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

export interface GatewayCredential {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * The only buckets this pair may touch. Absent means every bucket the gateway serves.
   *
   * ⛔ IT IS WHAT KEEPS ONE CUSTOMER'S KEY OFF ANOTHER CUSTOMER'S BUCKET. A gateway in front of
   *    many accounts hands each caller its own pair, and without this every pair would open every
   *    account the resolver knows.
   */
  readonly buckets?: readonly string[] | undefined;
}

/**
 * What a chunk-signed body needs to go on checking the request's signature: every chunk signature
 * is an HMAC under the same key, over a string that names the same timestamp and scope and the
 * signature before it -- starting from the request's own.
 */
export interface SigningContext {
  /** The key derived for this request's date, region and service. */
  readonly key: Buffer;
  /** `20130524/us-east-1/s3/aws4_request`. */
  readonly scope: string;
  /** The request's timestamp, `20130524T000000Z`. */
  readonly stamp: string;
  /** The request's signature, which the first chunk signature chains from. */
  readonly seedSignature: string;
}

export type Verified =
  | { readonly ok: true; readonly payloadHash: string; readonly signing: SigningContext }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** What `verifyAgainst` answers: the same verdict, plus which of the pairs signed. */
export type VerifiedAgainst =
  | {
      readonly ok: true;
      readonly payloadHash: string;
      readonly signing: SigningContext;
      readonly credential: GatewayCredential;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

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
  const scope = parseCredentialScope(credential);
  if (scope === null) return null;
  return {
    ...scope,
    signedHeaders: signedHeaders.split(";").filter((h) => h.length > 0),
    signature,
  };
}

/** Which of the two forms the request used, and its parts. */
function present(request: IncomingRequest): Presented | Refusal {
  const at = request.url.indexOf("?");
  const rawQuery = at < 0 ? "" : request.url.slice(at + 1);
  let parts: QueryPart[];
  try {
    parts = queryParts(rawQuery);
  } catch {
    return refuse("InvalidURI", "the query string has a percent escape that does not decode");
  }
  const presigned = isPresigned(parts);
  const header = headerValue(request.headers, "authorization");

  // ⛔ ONE SIGNATURE PER REQUEST. With both, which one was checked would be a choice this code
  //    made, and the other would be a signature nobody verified riding on a request that passed.
  if (presigned && header !== undefined) {
    return refuse("InvalidArgument", "a request is signed by an authorization header or by its query, not both");
  }
  // ⛔ NO SESSION TOKENS, IN EITHER FORM. This gateway hands out plain pairs and nothing else, so a
  //    request signed with temporary credentials was not signed with one of them. The presigned
  //    form's query parameter is refused where that form is read.
  if (headerValue(request.headers, "x-amz-security-token") !== undefined) {
    return refuse("InvalidToken", "this gateway issues no session tokens, so x-amz-security-token cannot be honoured");
  }
  if (presigned) return presentedFromQuery(request, parts);
  const auth = parseAuthorization(header);
  if (auth === null) {
    return refuse("AccessDenied", "no AWS Signature Version 4 authorization header or presigned query");
  }
  const problem = scopeProblem(auth);
  if (problem !== null) return refuse("AuthorizationHeaderMalformed", `The authorization header is malformed: ${problem}.`);
  return {
    ...auth,
    stamp: headerValue(request.headers, "x-amz-date"),
    expiresSeconds: null,
    canonicalQuery: canonicalOf(parts),
    payloadHash: headerValue(request.headers, "x-amz-content-sha256"),
  };
}

function isRefusal(value: Presented | Refusal): value is Refusal {
  return "ok" in value;
}

/**
 * The check itself, once the parts have been found and the pair chosen.
 *
 * ⛔ A PRESIGNED URL LIVES FROM ITS DATE TO ITS DATE PLUS `X-Amz-Expires`, AND NO LONGER. The skew
 *    rule still guards its start -- a URL dated further ahead than the clock may drift is refused --
 *    but its end is the lifetime it names with no slack added: slack on an expiry is a link that
 *    still works after the person who made it was told it would not.
 */
function verifyPresented(
  request: IncomingRequest,
  presented: Presented,
  credential: GatewayCredential,
  now: number,
): Verified {
  if (presented.accessKeyId !== credential.accessKeyId) {
    return refuse("InvalidAccessKeyId", "that access key is not the one this gateway printed");
  }

  const stamp = presented.stamp;
  const signedAt = amzDateToMs(stamp);
  if (stamp === undefined || signedAt === null) return refuse("AccessDenied", "missing or malformed x-amz-date");
  if (presented.expiresSeconds === null) {
    if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) {
      return refuse("RequestTimeTooSkewed", "the request's own timestamp is too far from this clock");
    }
  } else {
    if (signedAt - now > MAX_CLOCK_SKEW_MS) {
      return refuse("RequestTimeTooSkewed", "the presigned URL is dated further ahead than this clock allows");
    }
    if (now > signedAt + presented.expiresSeconds * 1000) {
      return refuse("AccessDenied", "Request has expired");
    }
  }
  // Exactly the day: the scope's date was checked to be eight digits, so an empty one cannot pass
  // as the start of every timestamp.
  if (stamp.slice(0, 8) !== presented.date) {
    return refuse("AccessDenied", "the signature's date does not match x-amz-date");
  }

  const unsigned = unsignedHeaders(request, presented);
  if (unsigned.length > 0) {
    return refuse(
      "AccessDenied",
      `There were headers present in the request which were not signed: ${unsigned.join(", ")}`,
    );
  }

  const payloadHash = presented.payloadHash;
  if (payloadHash === undefined) {
    return refuse("AccessDenied", "missing x-amz-content-sha256");
  }
  if (!isPayloadHash(payloadHash)) {
    return refuse(
      "InvalidArgument",
      "x-amz-content-sha256 must be a lowercase hex SHA-256, UNSIGNED-PAYLOAD or one of the STREAMING- values",
    );
  }

  const canonicalHeaders: string[] = [];
  for (const name of presented.signedHeaders) {
    const value = headerValue(request.headers, name);
    if (value === undefined) {
      return refuse("AccessDenied", `the signature covers a header that is not here: ${name}`);
    }
    canonicalHeaders.push(`${name}:${value.trim().replace(/\s+/g, " ")}\n`);
  }

  const at = request.url.indexOf("?");
  const path = at < 0 ? request.url : request.url.slice(0, at);
  const canonicalRequest = [
    request.method.toUpperCase(),
    path,
    presented.canonicalQuery,
    canonicalHeaders.join(""),
    presented.signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${presented.date}/${presented.region}/${presented.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const key = signingKey(credential.secretAccessKey, presented.date, presented.region, presented.service);
  const expected = createHmac("sha256", key).update(stringToSign).digest("hex");

  const given = Buffer.from(presented.signature, "utf8");
  const mine = Buffer.from(expected, "utf8");
  if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
    return refuse("SignatureDoesNotMatch", "the signature does not match what was signed");
  }
  return { ok: true, payloadHash, signing: { key, scope, stamp, seedSignature: expected } };
}

/**
 * Rebuild the string the client signed and check that the signature matches -- in the
 * `Authorization` header or in a presigned query, whichever the request carries.
 *
 * The clock is passed in rather than read here: a test that cannot choose "now" cannot check the
 * skew rule at all, and that rule is the one that stops a captured request being replayed tomorrow.
 */
export function verifySignature(
  request: IncomingRequest,
  credential: GatewayCredential,
  now: number,
): Verified {
  const presented = present(request);
  if (isRefusal(presented)) return presented;
  return verifyPresented(request, presented, credential, now);
}

/**
 * Which of a gateway's pairs the request named, without telling the clock how many there are.
 *
 * ⛔ EVERY PAIR IS COMPARED AND THE LOOP DOES NOT STOP EARLY. An access key id is not a secret --
 *    it travels in the header in the clear -- but a scan that returned at the first match would
 *    take a length of time that says WHERE in the list a key sits, and that is a fact about the
 *    gateway's customers rather than about the request.
 *
 * ⛔ TWO PAIRS WITH ONE ID ARE NOBODY'S. Which secret, and which bucket restriction, a request is
 *    held to would otherwise be whichever came later in the list -- a choice made by the order a
 *    business happened to build it in. `gatewayHandler` refuses such a list when the gateway is
 *    made; this answers `"ambiguous"` for a list changed after that.
 */
function named(
  credentials: readonly GatewayCredential[],
  accessKeyId: string,
): GatewayCredential | "ambiguous" | null {
  const wanted = Buffer.from(accessKeyId, "utf8");
  let found: GatewayCredential | null = null;
  let matches = 0;
  for (const candidate of credentials) {
    const id = Buffer.from(candidate.accessKeyId, "utf8");
    if (id.length === wanted.length && timingSafeEqual(id, wanted)) {
      found = candidate;
      matches += 1;
    }
  }
  return matches > 1 ? "ambiguous" : found;
}

/**
 * The whole check, against every pair a gateway answers to: which one signed, and whether it did.
 *
 * ⚠ THE THREE REFUSALS ARE DIFFERENT ON PURPOSE. "No signature at all", "a key this gateway does
 *   not have" and "a signature that does not hold" are three different things for whoever is
 *   reading a client's logs, and none of them says anything about what is in the drive.
 */
export function verifyAgainst(
  request: IncomingRequest,
  credentials: readonly GatewayCredential[],
  now: number,
): VerifiedAgainst {
  const presented = present(request);
  if (isRefusal(presented)) return presented;
  const credential = named(credentials, presented.accessKeyId);
  if (credential === null) {
    return refuse("InvalidAccessKeyId", "that access key is not one this gateway answers to");
  }
  if (credential === "ambiguous") {
    return refuse("InvalidAccessKeyId", "more than one of this gateway's pairs has that access key id");
  }
  const verdict = verifyPresented(request, presented, credential, now);
  return verdict.ok ? { ...verdict, credential } : verdict;
}
