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

/** Sign one request the way an S3 client would, for `http://127.0.0.1:<port><target>`. */
export function sign(
  method: string,
  target: string,
  host: string,
  credential: { accessKeyId: string; secretAccessKey: string },
  when: Date,
  body: Buffer = Buffer.alloc(0),
): SignedFetch {
  const stamp = when.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = stamp.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const rawQuery = at < 0 ? "" : target.slice(at + 1);
  const query = rawQuery
    .split("&")
    .filter((p) => p.length > 0)
    .sort()
    .join("&");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonical = [
    method.toUpperCase(),
    path,
    query,
    signedHeaders.map((h) => `${h}:${headers[h] ?? ""}\n`).join(""),
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
