// Signature checking for the local S3 gateway, measured against a request a real client signed.
//
// ⛔ WHY THE FIXTURE IS A CAPTURE AND NOT A HAND-WRITTEN VECTOR. A verifier tested only against
//    strings this repository also produced proves that two of our own functions agree. The request
//    below came off the wire from rclone v1.74.4 with the secret named here, recorded by a server
//    that did nothing but write it down. If the canonicalisation is wrong in any of the ways it is
//    easy to get wrong -- the query re-encoded, the path normalised, header values not collapsed --
//    this request stops verifying, and that is the whole point of keeping it.
//
// ⚠ The clock is passed in, so these run the same in a year as they do today.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { verifySignature, canonicalQuery, amzDateToMs, type IncomingRequest } from "../src/s3/sigv4.ts";

/** Not a secret: it never opened anything. The recording server refused every request it signed. */
const CREDENTIAL = {
  accessKeyId: "NMTSEXAMPLEKEYID0001",
  secretAccessKey: "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01",
};

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** rclone v1.74.4, `rclone lsf nmtstest:drive`, captured 2026-08-24. */
const CAPTURED: IncomingRequest = {
  method: "GET",
  url: "/drive?delimiter=%2F&max-keys=1000&prefix=",
  headers: {
    host: "127.0.0.1:9000",
    "user-agent": "rclone/v1.74.4",
    "accept-encoding": "identity",
    "amz-sdk-invocation-id": "44cc0fa3-408b-4e6b-8e5c-fce6cc3451b5",
    "amz-sdk-request": "attempt=1; max=1",
    authorization:
      "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260824/us-east-1/s3/aws4_request, " +
      "SignedHeaders=accept-encoding;amz-sdk-invocation-id;amz-sdk-request;host;x-amz-content-sha256;x-amz-date, " +
      "Signature=eb53d527c8ddf25d27bfb1ebc4930dad0b4150329cc15a43d0f2ed0c8d7bdc92",
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": "20260824T232759Z",
  },
};

const SIGNED_AT = amzDateToMs("20260824T232759Z") ?? 0;

/** The same request with one thing changed. */
function altered(change: Partial<IncomingRequest> & { header?: [string, string] }): IncomingRequest {
  const headers = { ...CAPTURED.headers };
  if (change.header !== undefined) headers[change.header[0]] = change.header[1];
  return {
    method: change.method ?? CAPTURED.method,
    url: change.url ?? CAPTURED.url,
    headers,
  };
}

test("a request a real client signed verifies", () => {
  const verdict = verifySignature(CAPTURED, CREDENTIAL, SIGNED_AT + 1_000);
  assert.equal(verdict.ok, true, verdict.ok ? "" : `${verdict.code}: ${verdict.message}`);
  assert.equal(verdict.ok === true ? verdict.payloadHash : "", EMPTY_SHA256);
});

test("⛔ every part the signature covers is actually covered", () => {
  const tampered: ReadonlyArray<readonly [string, IncomingRequest]> = [
    ["the path", altered({ url: "/other?delimiter=%2F&max-keys=1000&prefix=" })],
    ["the query", altered({ url: "/drive?delimiter=%2F&max-keys=1001&prefix=" })],
    ["a query value nobody reads", altered({ url: "/drive?delimiter=%2F&max-keys=1000&prefix=x" })],
    ["the method", altered({ method: "DELETE" })],
    ["a signed header", altered({ header: ["amz-sdk-request", "attempt=2; max=1"] })],
    ["the declared payload hash", altered({ header: ["x-amz-content-sha256", "UNSIGNED-PAYLOAD"] })],
  ];
  for (const [what, request] of tampered) {
    const verdict = verifySignature(request, CREDENTIAL, SIGNED_AT + 1_000);
    assert.equal(verdict.ok, false, `${what} was changed and the signature still passed`);
  }
});

test("⛔ a different secret does not open it", () => {
  const verdict = verifySignature(
    CAPTURED,
    { ...CREDENTIAL, secretAccessKey: "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY02" },
    SIGNED_AT + 1_000,
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false ? verdict.code : "", "SignatureDoesNotMatch");
});

test("⛔ another access key is refused before any hashing happens", () => {
  const verdict = verifySignature(CAPTURED, { ...CREDENTIAL, accessKeyId: "SOMEONEELSE000000001" }, SIGNED_AT);
  assert.equal(verdict.ok === false ? verdict.code : "", "InvalidAccessKeyId");
});

// ⛔ THE ONE THAT MAKES A CAPTURE SAFE TO KEEP. Without a skew rule this file would be a working
//    request anybody could replay for as long as the gateway runs.
test("⛔ a captured request does not work later", () => {
  const later = verifySignature(CAPTURED, CREDENTIAL, SIGNED_AT + 16 * 60 * 1000);
  assert.equal(later.ok === false ? later.code : "", "RequestTimeTooSkewed");
  const earlier = verifySignature(CAPTURED, CREDENTIAL, SIGNED_AT - 16 * 60 * 1000);
  assert.equal(earlier.ok === false ? earlier.code : "", "RequestTimeTooSkewed");
  // Still inside the window, either side.
  assert.equal(verifySignature(CAPTURED, CREDENTIAL, SIGNED_AT + 14 * 60 * 1000).ok, true);
});

test("⛔ no authorization header at all is a refusal, not a pass", () => {
  const headers = { ...CAPTURED.headers };
  delete headers["authorization"];
  const verdict = verifySignature({ ...CAPTURED, headers }, CREDENTIAL, SIGNED_AT);
  assert.equal(verdict.ok, false);
});

test("the query string is canonicalised the way AWS orders it", () => {
  assert.equal(canonicalQuery("b=2&a=1"), "a=1&b=2");
  assert.equal(canonicalQuery("prefix=&delimiter=%2F"), "delimiter=%2F&prefix=");
  assert.equal(canonicalQuery("a=2&a=1"), "a=1&a=2");
  assert.equal(canonicalQuery("list-type=2"), "list-type=2");
  // ⚠ The four JavaScript leaves alone and AWS does not.
  assert.equal(canonicalQuery("prefix=a(b)"), "prefix=a%28b%29");
  assert.equal(canonicalQuery(""), "");
});
