// What the S3 gateway makes of an `aws-chunked` upload body: the framing taken off, every chunk
// signature and trailer held to -- or the refusal an S3 client expects, with its status and code.
// Plain bodies are in `s3-body.test.ts`.
//
// ⛔ THE CHUNK SIGNATURES ARE HELD TO THE AWS DOCUMENTATION, NOT ONLY TO OUR OWN SIGNER. The two
//    documented examples (a chunk-signed upload, and the same with a signed trailing checksum) are
//    written out below byte for byte with the signatures AWS published. If the chain, the string
//    each chunk signs or the trailer's canonical form were wrong, those uploads would be refused,
//    and our signer agreeing with our verifier would not hide it.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { BodyRefusal, decodeBody } from "../src/s3/body.ts";
import { checksumOf } from "../src/s3/checksum.ts";
import { STREAMING_PAYLOAD, STREAMING_PAYLOAD_TRAILER, verifyAgainst } from "../src/s3/sigv4.ts";
import {
  accepted,
  ALGORITHMS,
  collect,
  CREDENTIAL,
  DATA,
  decode,
  HOST,
  refused,
  requestOf,
  run,
  split,
  verdictOf,
  WHEN,
  type OkVerdict,
} from "./s3-body-harness.ts";
import {
  frameChunks,
  signingKeyFor,
  signPlain,
  signStreaming,
  type SignedFetch,
  type StreamingOptions,
} from "./s3-sign.ts";

// ---------------------------------------------------------------------------------------------
// The AWS documentation's examples, byte for byte.

const DOC_CREDENTIAL = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE", // nmts-secret-scan: allow the example key printed in the AWS documentation
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const DOC_STAMP = "20130524T000000Z";
const DOC_SCOPE = "20130524/us-east-1/s3/aws4_request";
const DOC_NOW = Date.UTC(2013, 4, 24, 0, 0, 30);
const DOC_DATA = Buffer.alloc(66_560, "a");

/** The chunk-signed PUT from "Signature Calculations for the Authorization Header: Transferring Payload in Multiple Chunks". */
const DOC_REQUEST_HEADERS = {
  host: "s3.amazonaws.com",
  "x-amz-date": DOC_STAMP,
  "x-amz-storage-class": "REDUCED_REDUNDANCY",
  authorization:
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request," + // nmts-secret-scan: allow the AWS documentation's example key
    "SignedHeaders=content-encoding;content-length;host;x-amz-content-sha256;x-amz-date;" +
    "x-amz-decoded-content-length;x-amz-storage-class," +
    "Signature=4f232c4386841ef735655705268965c44a0e4690baa4adea153f7db9fa80a0a9",
  "x-amz-content-sha256": STREAMING_PAYLOAD,
  "content-encoding": "aws-chunked",
  "x-amz-decoded-content-length": "66560",
  "content-length": "66824",
};

function docBody(signatures: readonly [string, string, string]): Buffer {
  return Buffer.concat([
    Buffer.from(`10000;chunk-signature=${signatures[0]}\r\n`),
    DOC_DATA.subarray(0, 65_536),
    Buffer.from(`\r\n400;chunk-signature=${signatures[1]}\r\n`),
    DOC_DATA.subarray(65_536),
    Buffer.from(`\r\n0;chunk-signature=${signatures[2]}\r\n\r\n`),
  ]);
}

const DOC_SIGNATURES: readonly [string, string, string] = [
  "ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648",
  "0055627c9e194cb4542bae2aa5492e3c1575bbb81b612b7d234b86a503ef5497",
  "b6c6ea8a5354eaf15b3cb7646744f4275b71ea724fed81ceb9323e279d449df9",
];

function docVerdict(): OkVerdict {
  const verdict = verifyAgainst(
    { method: "PUT", url: "/examplebucket/chunkObject.txt", headers: DOC_REQUEST_HEADERS },
    [DOC_CREDENTIAL],
    DOC_NOW,
  );
  if (!verdict.ok) assert.fail(`the documented request was refused: ${verdict.code}: ${verdict.message}`);
  return verdict;
}

test("the AWS documentation's chunk-signed upload decodes, signature by signature", async () => {
  const body = docBody(DOC_SIGNATURES);
  assert.equal(body.length, 66_824, "the documented Content-Length");
  const outcome = await run(requestOf(DOC_REQUEST_HEADERS, split(body, 1000)), docVerdict());
  accepted(outcome, DOC_DATA);
  assert.equal(outcome.size, 66_560);
});

test("⛔ any one of the documented chunk signatures changed is refused", async () => {
  for (let i = 0; i < 3; i++) {
    const signatures: [string, string, string] = [...DOC_SIGNATURES];
    const original = signatures[i] ?? "";
    signatures[i] = `${original.slice(0, 63)}${original.endsWith("0") ? "1" : "0"}`;
    const outcome = await run(requestOf(DOC_REQUEST_HEADERS, [docBody(signatures)]), docVerdict());
    assert.deepEqual(outcome.refusal, { status: 403, code: "SignatureDoesNotMatch" }, `chunk ${i + 1}`);
  }
  const tampered = docBody(DOC_SIGNATURES);
  tampered[1000] = 0x62;
  refused(await run(requestOf(DOC_REQUEST_HEADERS, [tampered]), docVerdict()), 403, "SignatureDoesNotMatch");
});

/**
 * The same upload with a trailing CRC32C, from "Signature Calculations for Trailing Headers". The
 * seed signature is the documented one and is taken as given -- the request it signs is not
 * rebuilt here -- and every signature after it is the documented one too, so what this proves is
 * the chain, the trailer's canonical form and its signature.
 */
test("the AWS documentation's chunk-signed upload with a signed trailer decodes", async () => {
  const seed = "106e2a8a18243abcf37539882f36619c00e2dfc72633413f02d3b74544bfeb8e";
  const body = Buffer.concat([
    Buffer.from("10000;chunk-signature=b474d8862b1487a5145d686f57f013e54db672cee1c953b3010fb58501ef5aa2\r\n"),
    DOC_DATA.subarray(0, 65_536),
    Buffer.from("\r\n400;chunk-signature=1c1344b170168f8e65b41376b44b20fe354e373826ccbbe2c1d40a8cae51e5c7\r\n"),
    DOC_DATA.subarray(65_536),
    Buffer.from(
      "\r\n0;chunk-signature=2ca2aba2005185cf7159c6277faf83795951dd77a3a99e6e65d5c9f85863f992\r\n" +
        "x-amz-checksum-crc32c:sOO8/Q==\r\n" +
        "x-amz-trailer-signature:d81f82fc3505edab99d459891051a732e8730629a2e4a59689829ca17fe2e435\r\n" +
        "\r\n",
    ),
  ]);
  const verdict: OkVerdict = {
    ok: true,
    payloadHash: STREAMING_PAYLOAD_TRAILER,
    signing: {
      key: signingKeyFor(DOC_CREDENTIAL.secretAccessKey, "20130524"),
      scope: DOC_SCOPE,
      stamp: DOC_STAMP,
      seedSignature: seed,
    },
    credential: DOC_CREDENTIAL,
  };
  const headers = {
    "content-encoding": "aws-chunked",
    "x-amz-decoded-content-length": "66560",
    "x-amz-trailer": "x-amz-checksum-crc32c",
  };
  accepted(await run(requestOf(headers, split(body, 777)), verdict), DOC_DATA);

  const otherValue = Buffer.from(body.toString("latin1").replace("sOO8/Q==", "sOO8/A=="), "latin1");
  refused(await run(requestOf(headers, [otherValue]), verdict), 403, "SignatureDoesNotMatch");
});

// ---------------------------------------------------------------------------------------------
// aws-chunked round trips and refusals.

function streaming(options: StreamingOptions, data: Buffer = DATA): SignedFetch {
  return signStreaming("PUT", "/drive/big.bin", HOST, CREDENTIAL, WHEN, data, options);
}

test("a chunk-signed body decodes at any chunk size, split at any byte", async () => {
  for (const chunkSize of [1, 7, 8192, DATA.length, DATA.length + 10]) {
    const small = chunkSize < 8 ? DATA.subarray(0, 300) : DATA;
    const signed = streaming({ mode: "signed", chunkSize }, small);
    accepted(await decode(signed, { every: chunkSize === 1 ? 1 : 5 }), small);
  }
  const empty = streaming({ mode: "signed", chunkSize: 8192 }, Buffer.alloc(0));
  accepted(await decode(empty), Buffer.alloc(0));
});

test("⛔ a chunk-signed body with a changed byte, a changed signature or chunks swapped is refused", async () => {
  const signed = streaming({ mode: "signed", chunkSize: 4096 });
  const body = signed.body ?? Buffer.alloc(0);

  const changedByte = Buffer.from(body);
  changedByte[5000] = (changedByte[5000] ?? 0) ^ 1;
  refused(await decode(signed, { body: changedByte }), 403, "SignatureDoesNotMatch", false);

  const text = body.toString("latin1");
  const first = /chunk-signature=([0-9a-f]{64})/.exec(text)?.[1] ?? "";
  const changedSignature = Buffer.from(text.replace(first, "0".repeat(64)), "latin1");
  refused(await decode(signed, { body: changedSignature }), 403, "SignatureDoesNotMatch", false);

  // Two equal-sized chunks traded places: each still carries a valid signature of its own bytes,
  // and only the chain says they are out of order.
  const [a, b, ...rest] = text.split(/(?=1000;chunk-signature=)/);
  const swapped = Buffer.from([b, a, ...rest].join(""), "latin1");
  refused(await decode(signed, { body: swapped }), 403, "SignatureDoesNotMatch", false);
});

test("⛔ x-amz-decoded-content-length is required on a framed body and held to it", async () => {
  const signed = streaming({ mode: "signed", chunkSize: 4096 });
  refused(await decode(signed, { headers: { "x-amz-decoded-content-length": undefined } }), 411, "MissingContentLength", true);
  const tooLong = streaming({ mode: "signed", chunkSize: 4096, headers: { "x-amz-decoded-content-length": String(DATA.length + 1) } });
  refused(await decode(tooLong), 400, "IncompleteBody", false);
  const tooShort = streaming({ mode: "signed", chunkSize: 4096, headers: { "x-amz-decoded-content-length": String(DATA.length - 1) } });
  refused(await decode(tooShort), 400, "IncompleteBody", false);
});

test("⛔ framing that is not aws-chunked is refused, and a body cut before its last chunk is incomplete", async () => {
  const signed = streaming({ mode: "signed", chunkSize: 4096 });
  const body = signed.body ?? Buffer.alloc(0);
  const text = body.toString("latin1");

  refused(await decode(signed, { body: Buffer.from(`zz${text}`, "latin1") }), 400, "InvalidRequest", false);
  const noSignature = Buffer.from(text.replace(/;chunk-signature=[0-9a-f]{64}/, ""), "latin1");
  refused(await decode(signed, { body: noSignature }), 400, "InvalidRequest", false);
  const bareNewline = Buffer.from(text.replace("\r\n", "\n"), "latin1");
  refused(await decode(signed, { body: bareNewline }), 400, "InvalidRequest", false);
  refused(await decode(signed, { body: Buffer.concat([body, Buffer.from("extra")]) }), 400, "InvalidRequest", false);
  const lastChunk = text.lastIndexOf("0;chunk-signature=");
  refused(await decode(signed, { body: body.subarray(0, lastChunk) }), 400, "IncompleteBody", false);
  refused(await decode(signed, { body: body.subarray(0, 2000) }), 400, "IncompleteBody", false);
});

test("a chunk-signed body with a signed trailing checksum decodes, and a wrong checksum is BadDigest", async () => {
  for (const algorithm of ALGORITHMS) {
    const trailer = { name: `x-amz-checksum-${algorithm}`, value: checksumOf(algorithm, DATA) };
    const signed = streaming({ mode: "signed-trailer", chunkSize: 5000, trailer });
    accepted(await decode(signed, { every: 3 }), DATA);
  }
  // Signed correctly over a checksum that does not match: the signature holds, the bytes do not.
  const wrong = streaming({
    mode: "signed-trailer",
    chunkSize: 5000,
    trailer: { name: "x-amz-checksum-crc32c", value: checksumOf("crc32c", Buffer.from("other")) },
  });
  refused(await decode(wrong), 400, "BadDigest", false);
});

test("⛔ a signed trailer that was changed, or that lost its signature, is refused", async () => {
  const signed = streaming({
    mode: "signed-trailer",
    chunkSize: 5000,
    trailer: { name: "x-amz-checksum-crc32", value: checksumOf("crc32", DATA) },
  });
  const text = (signed.body ?? Buffer.alloc(0)).toString("latin1");
  const otherValue = text.replace(checksumOf("crc32", DATA), checksumOf("crc32", Buffer.from("other")));
  refused(await decode(signed, { body: Buffer.from(otherValue, "latin1") }), 403, "SignatureDoesNotMatch", false);
  const unsigned = text.replace(/x-amz-trailer-signature:[0-9a-f]{64}\r\n/, "");
  refused(await decode(signed, { body: Buffer.from(unsigned, "latin1") }), 400, "InvalidRequest", false);
});

test("an unsigned body with a trailing checksum decodes for every algorithm S3 names", async () => {
  for (const algorithm of ALGORITHMS) {
    const trailer = { name: `x-amz-checksum-${algorithm}`, value: checksumOf(algorithm, DATA) };
    const signed = streaming({ mode: "unsigned-trailer", chunkSize: 8192, trailer, omitContentLength: true });
    const outcome = await decode(signed, { every: 7 });
    accepted(outcome, DATA);
    assert.equal(outcome.size, DATA.length);
  }
});

test("⛔ an unsigned trailing checksum that does not match the bytes is BadDigest", async () => {
  for (const algorithm of ALGORITHMS) {
    const trailer = { name: `x-amz-checksum-${algorithm}`, value: checksumOf(algorithm, DATA) };
    const signed = streaming({ mode: "unsigned-trailer", chunkSize: 8192, trailer });
    const body = Buffer.from(signed.body ?? Buffer.alloc(0));
    body[20] = (body[20] ?? 0) ^ 1;
    const outcome = await decode(signed, { body });
    assert.deepEqual(outcome.refusal, { status: 400, code: "BadDigest" }, algorithm);
  }
});

test("⛔ a trailer that was promised and not sent, or sent and not promised, is refused", async () => {
  const trailer = { name: "x-amz-checksum-crc32", value: checksumOf("crc32", DATA) };
  const signed = streaming({ mode: "unsigned-trailer", chunkSize: 8192, trailer });
  const text = (signed.body ?? Buffer.alloc(0)).toString("latin1");
  const missing = Buffer.from(text.replace(/x-amz-checksum-crc32:[^\r]*\r\n/, ""), "latin1");
  refused(await decode(signed, { body: missing }), 400, "InvalidRequest", false);
  const unpromised = Buffer.from(text.replace("x-amz-checksum-crc32:", "x-amz-checksum-crc32c:"), "latin1");
  refused(await decode(signed, { body: unpromised }), 400, "InvalidRequest", false);

  const unknown = streaming({ mode: "unsigned-trailer", chunkSize: 8192, trailer: { name: "x-amz-checksum-md5", value: "AAAA" } });
  refused(await decode(unknown), 400, "InvalidRequest", true);
  const trailerOnPlain = signPlain("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, DATA, "UNSIGNED-PAYLOAD", {
    "content-length": String(DATA.length),
    "x-amz-trailer": "x-amz-checksum-crc32",
  });
  refused(await decode(trailerOnPlain), 400, "InvalidRequest", true);
});

test("an unsigned framed body that ends right after its last chunk is whole", async () => {
  // What the AWS SDK for JavaScript sends when it has no checksum to add: `0\r\n` and nothing more.
  const signed = streaming({ mode: "unsigned-trailer", chunkSize: 8192 });
  const framed = frameChunks(DATA, { mode: "unsigned-trailer", chunkSize: 8192 }, {
    key: Buffer.alloc(32),
    stamp: "",
    scope: "",
    seed: "",
  });
  const bare = framed.subarray(0, framed.length - 2);
  assert.ok(bare.toString("latin1").endsWith("\r\n0\r\n"));
  accepted(await decode(signed, { body: bare }), DATA);
});

test("⛔ a refusal halfway through ends the stream early and rejects verified", async () => {
  const signed = streaming({ mode: "signed", chunkSize: 1024 });
  const body = Buffer.from(signed.body ?? Buffer.alloc(0));
  body[3000] = (body[3000] ?? 0) ^ 1;
  const decoded = decodeBody(requestOf(signed.headers, split(body, 512)), verdictOf(signed));
  if (decoded instanceof BodyRefusal) assert.fail("refused before reading");
  // Read to the end first, then ask: the refusal is already there, not lost with the stream.
  const bytes = await collect(decoded.stream);
  assert.ok(bytes.length < DATA.length, "the stream went on past the bad chunk");
  await assert.rejects(decoded.verified, (error: unknown) => error instanceof BodyRefusal && error.code === "SignatureDoesNotMatch");
});

test("the seed for chunk signatures is the request's own signature", () => {
  const signed = streaming({ mode: "signed", chunkSize: 4096 });
  const verdict = verdictOf(signed);
  assert.equal(verdict.payloadHash, STREAMING_PAYLOAD);
  assert.ok((signed.headers["authorization"] ?? "").endsWith(`Signature=${verdict.signing.seedSignature}`));
});
