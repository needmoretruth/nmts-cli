// A minimal SigV4 signer, for tests only.
//
// ⛔ IT SIGNS; THE THING UNDER TEST VERIFIES. Both halves being ours would prove only that they
//    agree, so the question "is this really SigV4" is settled somewhere else: `s3-sigv4.test.ts`
//    verifies a request captured from a real client. What this file is for is driving the gateway
//    over real HTTP on every machine the tests run on, including the ones with no S3 tool installed.

import { createHash, createHmac } from "node:crypto";

export interface SignedFetch {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: Buffer;
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

/**
 * Sign one request the way an S3 client would, for `http://127.0.0.1:<port><target>`. `signed`
 * adds headers that are sent and signed with it, as a client signs every `x-amz-*` header it sends.
 */
export function sign(
  method: string,
  target: string,
  host: string,
  credential: { accessKeyId: string; secretAccessKey: string },
  when: Date,
  body: Buffer = Buffer.alloc(0),
  signed: Readonly<Record<string, string>> = {},
): SignedFetch {
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = stamp.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const rawQuery = at < 0 ? "" : target.slice(at + 1);
  // A parameter with no value is signed as `name=`, which is what clients that send `?uploads`
  // actually put in their canonical request. Leaving the `=` off produces a different signature
  // from the server's and the request is refused for a reason nobody can see.
  const query = rawQuery
    .split("&")
    .filter((p) => p.length > 0)
    .map((p) => (p.includes("=") ? p : `${p}=`))
    .sort()
    .join("&");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    ...signed,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonical = [
    method.toUpperCase(),
    path,
    query,
    // Values trimmed and inner runs of white space collapsed, as SigV4 canonicalises them.
    signedHeaders.map((h) => `${h}:${(headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join(""),
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${date}/us-east-1/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${credential.secretAccessKey}`, date), "us-east-1"), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return {
    method,
    url: `http://${host}${target}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
    },
    ...(body.length > 0 ? { body } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Presigned URLs and aws-chunked bodies. Same rule as above: the verifier is what is under test,
// and what keeps these honest is the other half of the suite -- captures from real clients and the
// AWS documentation's own example signatures -- not the fact that they agree with the verifier.

const REGION = "us-east-1";

/** `20130524T000000Z` for a Date. */
export function amzStamp(when: Date): string {
  return when.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The SigV4 signing key for one day. */
export function signingKeyFor(secretAccessKey: string, date: string, region = REGION): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), "s3"), "aws4_request");
}

/** RFC 3986 encoding, as SigV4 wants it in a query. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface Presigned {
  /** Path and query, as a request target. */
  readonly target: string;
  readonly url: string;
}

/**
 * A presigned URL for `http://<host><target>`: the signature in the query, `host` the only signed
 * header, the payload `UNSIGNED-PAYLOAD`. `extra` adds query parameters that are signed with it.
 */
export function presign(
  method: string,
  target: string,
  host: string,
  credential: { accessKeyId: string; secretAccessKey: string },
  when: Date,
  expiresSeconds: number,
  extra: Readonly<Record<string, string>> = {},
): Presigned {
  const stamp = amzStamp(when);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const existing = at < 0 ? [] : target.slice(at + 1).split("&").filter((p) => p.length > 0);
  const params: Array<[string, string]> = existing.map((p): [string, string] => {
    const eq = p.indexOf("=");
    return eq < 0
      ? [decodeURIComponent(p), ""]
      : [decodeURIComponent(p.slice(0, eq)), decodeURIComponent(p.slice(eq + 1))];
  });
  params.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credential.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
    ...Object.entries(extra),
  );
  const encoded = params.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`);
  const canonicalQuery = [...encoded].sort().join("&");
  const canonical = [method.toUpperCase(), path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", signingKeyFor(credential.secretAccessKey, date))
    .update(stringToSign)
    .digest("hex");
  const signed = `${path}?${[...encoded, `X-Amz-Signature=${signature}`].join("&")}`;
  return { target: signed, url: `http://${host}${signed}` };
}

export type StreamingMode = "signed" | "signed-trailer" | "unsigned-trailer";

export interface StreamingOptions {
  readonly mode: StreamingMode;
  /** How many decoded bytes go in each chunk; the last one carries what is left. */
  readonly chunkSize: number;
  /** One trailing header, `x-amz-checksum-…` and its base64 value, for the two trailer modes. */
  readonly trailer?: { readonly name: string; readonly value: string } | undefined;
  /** Leave `content-length` out, as a client that streams with `transfer-encoding: chunked` does. */
  readonly omitContentLength?: boolean | undefined;
  /** More headers to send and sign, such as `x-amz-checksum-crc32`. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

const PAYLOAD_OF: Readonly<Record<StreamingMode, string>> = {
  signed: "STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
  "signed-trailer": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER",
  "unsigned-trailer": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
};

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

/**
 * The `aws-chunked` framing of `data`, with the chunk and trailer signatures chained from `seed`
 * (for the unsigned mode, `seed` and `key` are unused). Exported so a test can frame bytes under a
 * seed it did not compute -- the one in the AWS documentation's example.
 */
export function frameChunks(
  data: Buffer,
  options: Pick<StreamingOptions, "mode" | "chunkSize" | "trailer">,
  signing: { readonly key: Buffer; readonly stamp: string; readonly scope: string; readonly seed: string },
): Buffer {
  const signed = options.mode !== "unsigned-trailer";
  const parts: Buffer[] = [];
  let previous = signing.seed;
  const chunkSignature = (bytes: Buffer): string => {
    previous = createHmac("sha256", signing.key)
      .update(
        [
          "AWS4-HMAC-SHA256-PAYLOAD",
          signing.stamp,
          signing.scope,
          previous,
          EMPTY_HASH,
          createHash("sha256").update(bytes).digest("hex"),
        ].join("\n"),
      )
      .digest("hex");
    return previous;
  };
  const pieces: Buffer[] = [];
  for (let at = 0; at < data.length; at += options.chunkSize) pieces.push(data.subarray(at, at + options.chunkSize));
  pieces.push(Buffer.alloc(0));
  for (const piece of pieces) {
    const head = signed ? `${piece.length.toString(16)};chunk-signature=${chunkSignature(piece)}` : piece.length.toString(16);
    parts.push(Buffer.from(`${head}\r\n`, "latin1"));
    if (piece.length > 0) parts.push(piece, Buffer.from("\r\n", "latin1"));
  }
  if (options.mode === "signed") {
    parts.push(Buffer.from("\r\n", "latin1"));
  } else {
    const trailer = options.trailer;
    const line = trailer === undefined ? "" : `${trailer.name}:${trailer.value}`;
    if (line.length > 0) parts.push(Buffer.from(`${line}\r\n`, "latin1"));
    if (options.mode === "signed-trailer") {
      const canonical = line.length > 0 ? `${line}\n` : "";
      const trailerSignature = createHmac("sha256", signing.key)
        .update(
          [
            "AWS4-HMAC-SHA256-TRAILER",
            signing.stamp,
            signing.scope,
            previous,
            createHash("sha256").update(canonical).digest("hex"),
          ].join("\n"),
        )
        .digest("hex");
      parts.push(Buffer.from(`x-amz-trailer-signature:${trailerSignature}\r\n`, "latin1"));
    }
    parts.push(Buffer.from("\r\n", "latin1"));
  }
  return Buffer.concat(parts);
}

/**
 * Sign one `aws-chunked` upload the way the AWS SDKs that stream do: the request signed over
 * headers only, then the body framed, each chunk signed with the signature before it.
 */
export function signStreaming(
  method: string,
  target: string,
  host: string,
  credential: { accessKeyId: string; secretAccessKey: string },
  when: Date,
  data: Buffer,
  options: StreamingOptions,
): SignedFetch {
  const stamp = amzStamp(when);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const key = signingKeyFor(credential.secretAccessKey, date);

  // The framed length depends on the signatures' fixed width, not on their values, so it is
  // measured on a dry run and signed before the real framing is made.
  const dry = frameChunks(data, options, { key, stamp, scope, seed: "0".repeat(64) });
  const headers: Record<string, string> = {
    host,
    "x-amz-date": stamp,
    "x-amz-content-sha256": PAYLOAD_OF[options.mode],
    "content-encoding": "aws-chunked",
    "x-amz-decoded-content-length": String(data.length),
    ...(options.omitContentLength === true ? {} : { "content-length": String(dry.length) }),
    ...(options.trailer === undefined ? {} : { "x-amz-trailer": options.trailer.name }),
    ...options.headers,
  };
  const signedHeaders = Object.keys(headers).sort();
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const rawQuery = at < 0 ? "" : target.slice(at + 1);
  const query = rawQuery
    .split("&")
    .filter((p) => p.length > 0)
    .map((p) => (p.includes("=") ? p : `${p}=`))
    .sort()
    .join("&");
  const canonical = [
    method.toUpperCase(),
    path,
    query,
    signedHeaders.map((h) => `${h}:${headers[h] ?? ""}\n`).join(""),
    signedHeaders.join(";"),
    PAYLOAD_OF[options.mode],
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  const seed = createHmac("sha256", key).update(stringToSign).digest("hex");
  const body = frameChunks(data, options, { key, stamp, scope, seed });

  return {
    method,
    url: `http://${host}${target}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders.join(";")}, Signature=${seed}`,
    },
    body,
  };
}

/**
 * Sign a plain (not framed) upload with any payload hash and any extra headers -- `UNSIGNED-PAYLOAD`,
 * a digest that does not match on purpose, a `content-md5`, an `x-amz-checksum-*`.
 */
export function signPlain(
  method: string,
  target: string,
  host: string,
  credential: { accessKeyId: string; secretAccessKey: string },
  when: Date,
  body: Buffer,
  payloadHash: string,
  extra: Readonly<Record<string, string>> = {},
): SignedFetch {
  const stamp = amzStamp(when);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const headers: Record<string, string> = {
    host,
    "x-amz-date": stamp,
    "x-amz-content-sha256": payloadHash,
    ...extra,
  };
  const signedHeaders = Object.keys(headers).sort();
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const canonical = [
    method.toUpperCase(),
    path,
    at < 0 ? "" : target.slice(at + 1).split("&").filter((p) => p.length > 0).map((p) => (p.includes("=") ? p : `${p}=`)).sort().join("&"),
    signedHeaders.map((h) => `${h}:${headers[h] ?? ""}\n`).join(""),
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonical).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", signingKeyFor(credential.secretAccessKey, date))
    .update(stringToSign)
    .digest("hex");
  return {
    method,
    url: `http://${host}${target}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
    },
    body,
  };
}
