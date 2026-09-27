// What the S3 gateway makes of a plain upload body -- one with no `aws-chunked` framing: its signed
// digest, its length, `Content-MD5` and `x-amz-checksum-*` headers held to the bytes, or the refusal
// an S3 client expects, with its status and code. The framed forms are in `s3-body-chunked.test.ts`.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { checksumOf } from "../src/s3/checksum.ts";
import { verifyAgainst } from "../src/s3/sigv4.ts";
import {
  accepted,
  ALGORITHMS,
  CREDENTIAL,
  DATA,
  decode,
  HOST,
  NOW,
  refused,
  requestOf,
  run,
  sha256hex,
  WHEN,
} from "./s3-body-harness.ts";
import { presign, signPlain } from "./s3-sign.ts";

// ---------------------------------------------------------------------------------------------
// Plain bodies.

test("a plain body with its digest comes out as it went in", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, sha256hex(DATA), {
    "content-length": String(DATA.length),
  });
  const outcome = await decode(signed, { every: 1000 });
  accepted(outcome, DATA);
  assert.equal(outcome.size, DATA.length);
});

test("⛔ a plain body that does not hash to its signed digest is refused", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, sha256hex(DATA), {
    "content-length": String(DATA.length),
  });
  const other = Buffer.from(DATA);
  other[100] = 0x21;
  refused(await decode(signed, { body: other }), 400, "XAmzContentSHA256Mismatch", false);
});

test("UNSIGNED-PAYLOAD is taken as it comes", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
  });
  accepted(await decode(signed), DATA);
});

test("⛔ a body with no length at all is refused before a byte is read", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD");
  refused(await decode(signed), 411, "MissingContentLength", true);
});

test("a plain body sent with only x-amz-decoded-content-length is counted against it", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "x-amz-decoded-content-length": String(DATA.length),
  });
  const outcome = await decode(signed, { every: 333 });
  accepted(outcome, DATA);
  assert.equal(outcome.size, DATA.length);
  refused(await decode(signed, { body: DATA.subarray(1) }), 400, "IncompleteBody", false);
  refused(await decode(signed, { body: Buffer.concat([DATA, Buffer.from("x")]) }), 400, "IncompleteBody", false);
});

test("⛔ a plain body cut off by the connection is not a whole body", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
  });
  refused(await decode(signed, { body: DATA.subarray(0, 500), cut: true }), 400, "IncompleteBody", false);
});

test("⛔ a body that says aws-chunked while the signature declares a plain payload is refused", async () => {
  const signed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
    "content-encoding": "aws-chunked",
  });
  refused(await decode(signed), 400, "InvalidRequest", true);
});

test("a presigned PUT's body is read as UNSIGNED-PAYLOAD", async () => {
  const url = presign("PUT", "/drive/upload.txt", HOST, CREDENTIAL, WHEN, 900);
  const verdict = verifyAgainst({ method: "PUT", url: url.target, headers: { host: HOST } }, [CREDENTIAL], NOW);
  if (!verdict.ok) assert.fail(`${verdict.code}: ${verdict.message}`);
  assert.equal(verdict.payloadHash, "UNSIGNED-PAYLOAD");
  accepted(await run(requestOf({ host: HOST, "content-length": String(DATA.length) }, [DATA]), verdict), DATA);
});

// ---------------------------------------------------------------------------------------------
// Content-MD5 and x-amz-checksum-* headers.

test("Content-MD5 is held to the bytes", async () => {
  const md5 = createHash("md5").update(DATA).digest("base64");
  const good = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
    "content-md5": md5,
  });
  accepted(await decode(good), DATA);
  const wrong = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
    "content-md5": createHash("md5").update("something else").digest("base64"),
  });
  refused(await decode(wrong), 400, "BadDigest", false);
  const malformed = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
    "content-md5": "not-a-digest",
  });
  refused(await decode(malformed), 400, "InvalidDigest", true);
});

test("every x-amz-checksum-* header is held to the bytes", async () => {
  for (const algorithm of ALGORITHMS) {
    const good = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, sha256hex(DATA), {
      "content-length": String(DATA.length),
      [`x-amz-checksum-${algorithm}`]: checksumOf(algorithm, DATA),
      "x-amz-sdk-checksum-algorithm": algorithm.toUpperCase(),
    });
    accepted(await decode(good, { every: 4096 }), DATA);
    const wrong = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
      "content-length": String(DATA.length),
      [`x-amz-checksum-${algorithm}`]: checksumOf(algorithm, Buffer.from("something else")),
    });
    const outcome = await decode(wrong);
    assert.deepEqual(outcome.refusal, { status: 400, code: "BadDigest" }, algorithm);
  }
});

test("⛔ a checksum this gateway does not know is refused, not skipped", async () => {
  const headers = { "content-length": String(DATA.length) };
  const unknownHeader = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    ...headers,
    "x-amz-checksum-md5": createHash("md5").update(DATA).digest("base64"),
  });
  refused(await decode(unknownHeader), 400, "InvalidRequest", true);
  const unknownAlgorithm = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    ...headers,
    "x-amz-sdk-checksum-algorithm": "MD5",
  });
  refused(await decode(unknownAlgorithm), 400, "InvalidRequest", true);
  const notAValue = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    ...headers,
    "x-amz-checksum-crc32": "AAAA",
  });
  refused(await decode(notAValue), 400, "InvalidRequest", true);
});
