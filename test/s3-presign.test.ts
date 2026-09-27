// Presigned URLs: the signature in the query string instead of a header, with a lifetime of its own.
//
// ⛔ THE FIRST FOUR ARE REAL. Two URLs from the AWS SDK for JavaScript v3's `getSignedUrl` and two
//    from botocore's `generate_presigned_url` (the library under the AWS CLI v1), made with the
//    throwaway pair below. They differ in ways a verifier built from the specification alone gets
//    wrong: the JavaScript SDK signs `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD` as a query parameter
//    and adds `x-id` and checksum parameters of its own; botocore adds nothing. The rest are made by
//    the test signer, to reach each refusal.
//
// ⚠ The clock is passed in, so these run the same in a year as they do today.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_PRESIGNED_EXPIRY_SECONDS,
  amzDateToMs,
  verifyAgainst,
  verifySignature,
  type IncomingRequest,
  type Verified,
} from "../src/s3/sigv4.ts";
import { presign, sign } from "./s3-sign.ts";

/** Not a secret: it never opened anything. */
const CREDENTIAL = {
  accessKeyId: "NMTSEXAMPLEKEYID0001",
  secretAccessKey: "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01",
};

interface CapturedUrl {
  readonly client: string;
  readonly method: string;
  readonly host: string;
  readonly target: string;
  readonly signedAt: string;
  readonly expires: number;
}

const CAPTURED: readonly CapturedUrl[] = [
  {
    client: "AWS SDK for JavaScript v3, GetObject",
    method: "GET",
    host: "127.0.0.1:41787",
    target:
      "/drive/photos/a%20b.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD" +
      "&X-Amz-Credential=NMTSEXAMPLEKEYID0001%2F20260924%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260924T013317Z&X-Amz-Expires=3600" +
      "&X-Amz-Signature=d2dc4feb40f71a7051e3d4a4c4312d574f58d3ca1db3a6051e19ebf947f772f2" +
      "&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
    signedAt: "20260924T013317Z",
    expires: 3600,
  },
  {
    client: "AWS SDK for JavaScript v3, PutObject",
    method: "PUT",
    host: "127.0.0.1:41787",
    target:
      "/drive/upload.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD" +
      "&X-Amz-Credential=NMTSEXAMPLEKEYID0001%2F20260924%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260924T013317Z&X-Amz-Expires=900" +
      "&X-Amz-Signature=d4d7458de08a7d69dc4a8f5f2203880ea584feff67934103af68eea1f0a513bd" +
      "&X-Amz-SignedHeaders=host&x-amz-checksum-crc32=AAAAAA%3D%3D&x-amz-sdk-checksum-algorithm=CRC32" +
      "&x-id=PutObject",
    signedAt: "20260924T013317Z",
    expires: 900,
  },
  {
    client: "botocore 1.34.46, get_object",
    method: "GET",
    host: "127.0.0.1:9000",
    target:
      "/drive/photos/a%20b.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=NMTSEXAMPLEKEYID0001%2F20260924%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260924T013414Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=0d6fc5a797e00aac8e10f7b7581bbea7de14ff92fc2ff44f60cd5a8d986911de",
    signedAt: "20260924T013414Z",
    expires: 3600,
  },
  {
    client: "botocore 1.34.46, put_object",
    method: "PUT",
    host: "127.0.0.1:9000",
    target:
      "/drive/upload.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=NMTSEXAMPLEKEYID0001%2F20260924%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260924T013414Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=13f4e6221b7666367b6394d5a6b079342139cac5a521cfc851a022c9304b59f0",
    signedAt: "20260924T013414Z",
    expires: 900,
  },
];

function requestOf(url: CapturedUrl, change: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    method: change.method ?? url.method,
    url: change.url ?? url.target,
    headers: change.headers ?? { host: url.host },
  };
}

function codeOf(verdict: Verified): string {
  return verdict.ok ? "ok" : verdict.code;
}

test("presigned URLs real clients made verify, as UNSIGNED-PAYLOAD", () => {
  for (const url of CAPTURED) {
    const signedAt = amzDateToMs(url.signedAt) ?? 0;
    const verdict = verifySignature(requestOf(url), CREDENTIAL, signedAt + 5_000);
    assert.equal(verdict.ok, true, `${url.client}: ${verdict.ok ? "" : `${verdict.code}: ${verdict.message}`}`);
    assert.equal(verdict.ok ? verdict.payloadHash : "", "UNSIGNED-PAYLOAD", url.client);
  }
});

test("⛔ every part of a real presigned URL is covered by its signature", () => {
  for (const url of CAPTURED) {
    const now = (amzDateToMs(url.signedAt) ?? 0) + 5_000;
    const tampered: ReadonlyArray<readonly [string, IncomingRequest]> = [
      ["the method", requestOf(url, { method: url.method === "GET" ? "PUT" : "GET" })],
      ["the path", requestOf(url, { url: url.target.replace("/drive/", "/other/") })],
      ["the lifetime", requestOf(url, { url: url.target.replace(`X-Amz-Expires=${url.expires}`, "X-Amz-Expires=604800") })],
      ["an added parameter", requestOf(url, { url: `${url.target}&prefix=x` })],
      ["the host", requestOf(url, { headers: { host: "127.0.0.1:1" } })],
      ["the signature", requestOf(url, { url: url.target.replace(/X-Amz-Signature=[0-9a-f]/, "X-Amz-Signature=x") })],
    ];
    for (const [what, request] of tampered) {
      assert.equal(codeOf(verifySignature(request, CREDENTIAL, now)), "SignatureDoesNotMatch", `${url.client}: ${what}`);
    }
  }
});

test("⛔ a presigned URL stops working when its lifetime ends, and not a second later", () => {
  for (const url of CAPTURED) {
    const signedAt = amzDateToMs(url.signedAt) ?? 0;
    const end = signedAt + url.expires * 1000;
    assert.equal(codeOf(verifySignature(requestOf(url), CREDENTIAL, end)), "ok", url.client);
    const late = verifySignature(requestOf(url), CREDENTIAL, end + 1_000);
    assert.equal(codeOf(late), "AccessDenied", url.client);
    assert.equal(late.ok ? "" : late.message, "Request has expired");
  }
});

test("⛔ a presigned URL dated further ahead than the clock may drift is refused", () => {
  const url = CAPTURED[0];
  if (url === undefined) assert.fail("no capture");
  const signedAt = amzDateToMs(url.signedAt) ?? 0;
  assert.equal(codeOf(verifySignature(requestOf(url), CREDENTIAL, signedAt - 16 * 60 * 1000)), "RequestTimeTooSkewed");
  assert.equal(codeOf(verifySignature(requestOf(url), CREDENTIAL, signedAt - 14 * 60 * 1000)), "ok");
});

const HOST = "127.0.0.1:9000";
const WHEN = new Date("2026-09-24T02:00:00Z");
const NOW = WHEN.getTime() + 1_000;

test("the test signer's presigned URLs verify, for any method and a query of their own", () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "POST"]) {
    const url = presign(method, "/drive/a%20folder/b.txt?uploadId=abc&partNumber=2", HOST, CREDENTIAL, WHEN, 60);
    const verdict = verifySignature({ method, url: url.target, headers: { host: HOST } }, CREDENTIAL, NOW);
    assert.equal(codeOf(verdict), "ok", method);
  }
  const longest = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, MAX_PRESIGNED_EXPIRY_SECONDS);
  assert.equal(codeOf(verifySignature({ method: "GET", url: longest.target, headers: { host: HOST } }, CREDENTIAL, NOW)), "ok");
});

test("⛔ a lifetime outside 1 second to 7 days is refused", () => {
  for (const expires of [0, MAX_PRESIGNED_EXPIRY_SECONDS + 1]) {
    const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, expires);
    const verdict = verifySignature({ method: "GET", url: url.target, headers: { host: HOST } }, CREDENTIAL, NOW);
    assert.equal(codeOf(verdict), "AuthorizationQueryParametersError", String(expires));
  }
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const notANumber = url.target.replace("X-Amz-Expires=60", "X-Amz-Expires=soon");
  assert.equal(
    codeOf(verifySignature({ method: "GET", url: notANumber, headers: { host: HOST } }, CREDENTIAL, NOW)),
    "AuthorizationQueryParametersError",
  );
});

test("⛔ a presigned URL that is missing a part, repeats one or names another algorithm is refused", () => {
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const variants = [
    url.target.replace(/&X-Amz-Signature=[0-9a-f]+/, ""),
    url.target.replace(/X-Amz-Date=[0-9TZ]+&/, ""),
    url.target.replace(/X-Amz-SignedHeaders=host&/, ""),
    `${url.target}&X-Amz-Date=20260924T020000Z`,
    url.target.replace("X-Amz-Algorithm=AWS4-HMAC-SHA256", "X-Amz-Algorithm=AWS4-ECDSA-P256-SHA256"),
    url.target.replace(/X-Amz-Credential=[^&]+/, "X-Amz-Credential=NMTSEXAMPLEKEYID0001%2F20260924"),
  ];
  for (const target of variants) {
    const verdict = verifySignature({ method: "GET", url: target, headers: { host: HOST } }, CREDENTIAL, NOW);
    assert.equal(codeOf(verdict), "AuthorizationQueryParametersError", target);
  }
});

test("⛔ a presigned URL carrying a session token is refused, even with a good signature", () => {
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60, { "X-Amz-Security-Token": "session" });
  const verdict = verifySignature({ method: "GET", url: url.target, headers: { host: HOST } }, CREDENTIAL, NOW);
  assert.equal(codeOf(verdict), "InvalidToken");
});

test("⛔ a request signed both in its header and in its query is refused", () => {
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const headerSigned = sign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN);
  const verdict = verifySignature({ method: "GET", url: url.target, headers: headerSigned.headers }, CREDENTIAL, NOW);
  assert.equal(codeOf(verdict), "InvalidArgument");
});

test("a presigned URL is checked against every pair and answers which one signed", () => {
  const other = { accessKeyId: "NMTSOTHERKEYID000002", secretAccessKey: "another-secret-that-is-not-real-000000" };
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const verdict = verifyAgainst({ method: "GET", url: url.target, headers: { host: HOST } }, [other, CREDENTIAL], NOW);
  assert.equal(verdict.ok ? verdict.credential.accessKeyId : verdict.code, CREDENTIAL.accessKeyId);
  const stranger = verifyAgainst({ method: "GET", url: url.target, headers: { host: HOST } }, [other], NOW);
  assert.equal(stranger.ok ? "ok" : stranger.code, "InvalidAccessKeyId");
});

test("a presigned URL takes its payload hash from the client when the client sends one", () => {
  const url = presign("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60, { "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD" });
  const verdict = verifySignature({ method: "PUT", url: url.target, headers: { host: HOST } }, CREDENTIAL, NOW);
  assert.equal(verdict.ok ? verdict.payloadHash : verdict.code, "UNSIGNED-PAYLOAD");
  // A header the URL did not sign cannot change what the signature covered.
  const digest = "a".repeat(64);
  const withHeader = verifySignature(
    { method: "PUT", url: url.target, headers: { host: HOST, "x-amz-content-sha256": digest } },
    CREDENTIAL,
    NOW,
  );
  assert.equal(codeOf(withHeader), "SignatureDoesNotMatch");
});
