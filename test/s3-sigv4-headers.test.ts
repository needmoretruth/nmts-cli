// What a signature has to cover, and what its scope has to say, before the gateway acts on a request.
//
// ⛔ THE FIRST TEST IS THE ATTACK. A presigned URL for "upload here" signs only its host; resent
//    with an `x-amz-copy-source` header nobody signed, it was answered as a copy of another file --
//    for a business that presigns for every customer with one pair, a read of any customer's file.
//    The rest pin down S3's rule (every `x-amz-*` header and `host` signed), the two headers it
//    exempts, the credential scope, and session tokens.

import { strict as assert } from "node:assert";
import { createHash, createHmac } from "node:crypto";
import { after, test } from "node:test";

import { createGateway } from "../src/s3/server.ts";
import { verifyAgainst, verifySignature, type IncomingRequest, type Verified } from "../src/s3/sigv4.ts";
import { CREDENTIAL, fakeDrive, listening, raw } from "./s3-gateway-drive.ts";
import { amzStamp, presign, sign } from "./s3-sign.ts";

const HOST = "127.0.0.1:9000";
const WHEN = new Date("2026-09-24T02:00:00Z");
const NOW = WHEN.getTime() + 1_000;

function codeOf(verdict: Verified): string {
  return verdict.ok ? "ok" : verdict.code;
}

function messageOf(verdict: Verified): string {
  return verdict.ok ? "" : verdict.message;
}

interface Scope {
  readonly date?: string;
  readonly region?: string;
  readonly service?: string;
}

/**
 * An `Authorization` header over exactly the headers named in `signed` -- which may leave out ones
 * that are sent -- under any scope. The test signer in `s3-sign.ts` always signs what it sends.
 */
function signOnly(
  method: string,
  target: string,
  headers: Readonly<Record<string, string>>,
  signed: readonly string[],
  scope: Scope = {},
): Record<string, string> {
  const stamp = amzStamp(WHEN);
  const date = scope.date ?? stamp.slice(0, 8);
  const region = scope.region ?? "us-east-1";
  const service = scope.service ?? "s3";
  const payload = headers["x-amz-content-sha256"] ?? "UNSIGNED-PAYLOAD";
  const canonical = [
    method,
    target,
    "",
    signed.map((h) => `${h}:${headers[h] ?? ""}\n`).join(""),
    signed.join(";"),
    payload,
  ].join("\n");
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, credentialScope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const hmac = (key: Buffer | string, value: string): Buffer => createHmac("sha256", key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${CREDENTIAL.secretAccessKey}`, date), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${CREDENTIAL.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signed.join(";")}, Signature=${signature}`,
  };
}

const BASE = { host: HOST, "x-amz-date": amzStamp(WHEN), "x-amz-content-sha256": "UNSIGNED-PAYLOAD" };

function check(method: string, target: string, headers: IncomingRequest["headers"]): Verified {
  return verifySignature({ method, url: target, headers }, CREDENTIAL, NOW);
}

// ── The attack, over a socket ───────────────────────────────────────────────────────────────────

const drive = await fakeDrive();
await drive.seed("secret.txt", "somebody else's file");
const source = drive.source();
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: (name) => (name === "drive" ? source : null) });
const GATEWAY = await listening(gateway);
after(() => gateway.close());

test("⛔ a presigned upload URL resent with an unsigned x-amz-copy-source is refused, and nothing is copied", async () => {
  const url = presign("PUT", "/drive/upload-here.bin", GATEWAY, CREDENTIAL, new Date(), 600);
  const before = drive.stores.length;
  const res = await raw(GATEWAY, "PUT", url.target, {
    host: GATEWAY,
    "content-length": "0",
    "x-amz-copy-source": "/drive/secret.txt",
    "x-amz-storage-class": "GLACIER",
  });
  assert.equal(res.status, 403);
  assert.match(res.body, /<Code>AccessDenied<\/Code>/);
  assert.match(res.body, /not signed: x-amz-copy-source, x-amz-storage-class</);
  assert.doesNotMatch(res.body, /CopyObjectResult/);
  assert.equal(drive.stores.length, before);
  assert.equal(drive.textAt("upload-here.bin"), undefined);

  // The same URL used as it was made still works.
  const intended = await raw(GATEWAY, "PUT", url.target, { host: GATEWAY, "content-length": "3" }, Buffer.from("abc"));
  assert.equal(intended.status, 200, intended.body);
  assert.equal(drive.textAt("upload-here.bin"), "abc");
});

// ── Which headers must be signed ────────────────────────────────────────────────────────────────

test("⛔ an x-amz-* header outside SignedHeaders is refused in the header form too", () => {
  const signed = sign("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN);
  const verdict = check("PUT", "/drive/a.txt", { ...signed.headers, "x-amz-metadata-directive": "REPLACE" });
  assert.equal(codeOf(verdict), "AccessDenied");
  assert.equal(
    messageOf(verdict),
    "There were headers present in the request which were not signed: x-amz-metadata-directive",
  );
  // Signed, the same header is fine.
  const covered = sign("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, Buffer.alloc(0), { "x-amz-metadata-directive": "REPLACE" });
  assert.equal(codeOf(check("PUT", "/drive/a.txt", covered.headers)), "ok");
});

test("⛔ a signature that does not cover host is refused, and so is one that covers nothing", () => {
  const noHost = signOnly("GET", "/drive/a.txt", BASE, ["x-amz-content-sha256", "x-amz-date"]);
  assert.equal(codeOf(check("GET", "/drive/a.txt", noHost)), "AccessDenied");
  assert.match(messageOf(check("GET", "/drive/a.txt", noHost)), /not signed: host$/);
  const nothing = signOnly("GET", "/drive/a.txt", BASE, []);
  assert.equal(codeOf(check("GET", "/drive/a.txt", nothing)), "AccessDenied");

  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const emptyList = url.target.replace("X-Amz-SignedHeaders=host", "X-Amz-SignedHeaders=");
  assert.equal(codeOf(check("GET", emptyList, { host: HOST })), "AccessDenied");
});

test("the two headers whose value the signature covers another way need not be listed", () => {
  // The header form's x-amz-date is the timestamp in the string to sign.
  const dateUnlisted = signOnly("GET", "/drive/a.txt", BASE, ["host", "x-amz-content-sha256"]);
  assert.equal(codeOf(check("GET", "/drive/a.txt", dateUnlisted)), "ok");
  // x-amz-content-sha256 is the last line of the canonical request, in both forms.
  const hashUnlisted = signOnly("GET", "/drive/a.txt", BASE, ["host", "x-amz-date"]);
  assert.equal(codeOf(check("GET", "/drive/a.txt", hashUnlisted)), "ok");
  const url = presign("PUT", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  assert.equal(codeOf(check("PUT", url.target, { host: HOST, "x-amz-content-sha256": "UNSIGNED-PAYLOAD" })), "ok");
  // A presigned URL's date is in its query, so an x-amz-date header is one more unsigned header.
  assert.equal(codeOf(check("PUT", url.target, { host: HOST, "x-amz-date": amzStamp(WHEN) })), "AccessDenied");
});

test("headers that are not x-amz-* may go unsigned, as S3 allows", () => {
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  const headers = { host: HOST, range: "bytes=0-1", "content-type": "text/plain", "user-agent": "curl/8", "x-amzn-trace-id": "Root=1" };
  assert.equal(codeOf(check("GET", url.target, headers)), "ok");
});

// ── The credential scope ────────────────────────────────────────────────────────────────────────

test("⛔ a scope whose date is empty, short or another day, or whose service is not s3, is refused", () => {
  const signed = ["host", "x-amz-content-sha256", "x-amz-date"];
  const cases: ReadonlyArray<readonly [string, Scope, string]> = [
    ["an empty date", { date: "" }, "AuthorizationHeaderMalformed"],
    ["a seven-digit date", { date: "2026092" }, "AuthorizationHeaderMalformed"],
    ["the day before", { date: "20260923" }, "AccessDenied"],
    ["another service", { service: "ec2" }, "AuthorizationHeaderMalformed"],
    ["no region", { region: "" }, "AuthorizationHeaderMalformed"],
  ];
  for (const [what, scope, code] of cases) {
    assert.equal(codeOf(check("GET", "/drive/a.txt", signOnly("GET", "/drive/a.txt", BASE, signed, scope))), code, what);
  }
  // Any region at all is answered: the gateway has none of its own.
  const elsewhere = signOnly("GET", "/drive/a.txt", BASE, signed, { region: "eu-central-1" });
  assert.equal(codeOf(check("GET", "/drive/a.txt", elsewhere)), "ok");
});

test("⛔ a presigned URL whose scope is malformed is refused", () => {
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  for (const credential of [
    `${CREDENTIAL.accessKeyId}%2F%2Fus-east-1%2Fs3%2Faws4_request`,
    `${CREDENTIAL.accessKeyId}%2F20260924%2Fus-east-1%2Fsts%2Faws4_request`,
    `${CREDENTIAL.accessKeyId}%2F20260924%2F%2Fs3%2Faws4_request`,
  ]) {
    const target = url.target.replace(/X-Amz-Credential=[^&]+/, `X-Amz-Credential=${credential}`);
    assert.equal(codeOf(check("GET", target, { host: HOST })), "AuthorizationQueryParametersError", credential);
  }
});

// ── Session tokens and duplicate pairs ──────────────────────────────────────────────────────────

test("⛔ a session token is refused in the header form, as it is in a presigned URL", () => {
  const withToken = sign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, Buffer.alloc(0), { "x-amz-security-token": "session" });
  assert.equal(codeOf(check("GET", "/drive/a.txt", withToken.headers)), "InvalidToken");
  const url = presign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN, 60);
  assert.equal(codeOf(check("GET", url.target, { host: HOST, "x-amz-security-token": "session" })), "InvalidToken");
});

test("⛔ two pairs with one access key id answer neither", () => {
  const signed = sign("GET", "/drive/a.txt", HOST, CREDENTIAL, WHEN);
  const twin = { ...CREDENTIAL, secretAccessKey: "a-different-secret-for-the-same-id-0000" };
  const verdict = verifyAgainst({ method: "GET", url: "/drive/a.txt", headers: signed.headers }, [CREDENTIAL, twin], NOW);
  assert.equal(verdict.ok ? "ok" : verdict.code, "InvalidAccessKeyId");
  const alone = verifyAgainst({ method: "GET", url: "/drive/a.txt", headers: signed.headers }, [CREDENTIAL], NOW);
  assert.equal(alone.ok ? "ok" : alone.code, "ok");
});
