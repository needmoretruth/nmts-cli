// What a failure is called when an S3 client reads it — because the name decides what the client does.
//
// ⛔ 503 `SlowDown` IS "WAIT AND SEND IT AGAIN"; 403 IS "STOP"; 500 IS "SOMETHING BROKE". A sync tool
//    told 500 for "no credits" retried an upload that could not succeed until somebody paid, and
//    one told 500 for "the storage network did not answer" gave up on what a minute would have
//    carried. Each code this gateway can meet is checked here, directly and over a socket.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { answerFor, PUSH_RETRY_AFTER_SECONDS, S3Refusal } from "../src/s3/answer.ts";
import { BodyRefusal } from "../src/s3/body.ts";
import { refusalFor } from "../src/s3/same-file.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, send } from "./s3-gateway-drive.ts";

const coded = (code: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(`refused: ${code}`), { code, ...extra });

test("the account cannot pay: 403 AccountProblem, its reason kept for the log and not sent", () => {
  for (const code of ["CREDITS_SHORT", "CREDIT_FILE_CAP", "CREDIT_DAILY_CAP", "WALLET_SHORT", "DEPOSIT_FEE_INSUFFICIENT"]) {
    const answer = answerFor(coded(code, { status: 402 }));
    assert.deepEqual([answer.status, answer.code], [403, "AccountProblem"], code);
    assert.doesNotMatch(answer.message, /refused/, code);
    assert.equal(answer.reason, `${code}: refused: ${code}`, code);
  }
});

test("not now, but later: 503 SlowDown, with Retry-After when the refusal said how long", () => {
  for (const code of ["RATE_LIMITED", "CHAIN_SPEND_CAP", "CHAIN_UNCERTAIN"]) {
    assert.deepEqual([answerFor(coded(code)).status, answerFor(coded(code)).code], [503, "SlowDown"], code);
  }
  assert.equal(answerFor(coded("RATE_LIMITED", { retryAfter: 2.5 })).retryAfter, 3);
  assert.equal(answerFor(coded("RATE_LIMITED")).retryAfter, null);
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(answerFor(Object.assign(new Error("x"), { status })).code, "SlowDown", String(status));
  }
});

test("NMTS or the storage network did not answer: 503 SlowDown", () => {
  const unreachable = [
    new Error("Could not reach https://nmts.example."),
    new Error("The server did not answer within 30000ms."),
    new Error("That file could not be read from the mainnet storage network."),
    new TypeError("fetch failed"),
    Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    Object.assign(new Error("wrapped"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }),
  ];
  for (const error of unreachable) assert.equal(answerFor(error).code, "SlowDown", error.message);
  // ⛔ The word "network" alone is not a network failure — this one will never succeed on retry.
  assert.equal(answerFor(new Error("That file is on a network this build cannot read.")).code, "InternalError");
});

test("whoever the account is reached through may not do this: 403 AccessDenied", () => {
  for (const code of ["DELEGATION_INVALID", "DELEGATION_EXPIRED", "DELEGATION_SCOPE", "NOT_A_MEMBER"]) {
    assert.deepEqual([answerFor(coded(code, { status: 401 })).status, answerFor(coded(code)).code], [403, "AccessDenied"]);
  }
});

test("a refusal with its own S3 code keeps it; a taken key is 409; anything else is 500", () => {
  assert.equal(answerFor(new BodyRefusal(400, "BadDigest", "x")).code, "BadDigest");
  assert.equal(answerFor(new S3Refusal(404, "NoSuchUpload", "x")).status, 404);
  assert.deepEqual([answerFor(refusalFor("differs", "k")).status, answerFor(refusalFor("differs", "k")).code], [409, "InvalidRequest"]);
  assert.deepEqual([answerFor(new Error("odd")).status, answerFor(new Error("odd")).code], [500, "InternalError"]);
  assert.equal(answerFor("a string was thrown").code, "InternalError");
  // Read as unknown: a `code` that is not a string, or a `status` that is not a number, means nothing.
  assert.equal(answerFor(Object.assign(new Error("x"), { code: 42, status: "503" })).code, "InternalError");
});

/** `[status, code]` of what a thrown value is answered with. */
const pair = (error: unknown): [number, string] => [answerFor(error).status, answerFor(error).code];

test("⛔ a refused credential, lapsed terms or a banned account is 403 AccessDenied, which no client retries", () => {
  for (const [code, status] of [
    ["API_KEY_REVOKED", 401],
    ["API_KEY_EXPIRED", 401],
    ["API_KEY_SCOPE", 403],
    ["TERMS_ACCEPTANCE_REQUIRED", 403],
    ["ACCOUNT_BANNED", 403],
    ["SESSION_REVOKED", 401],
    ["AGENT_VERIFY_REQUIRED", 403],
  ] as const) {
    assert.deepEqual(pair(coded(code, { status })), [403, "AccessDenied"], code);
  }
  // A code alone, with no status beside it, is enough for the ones named.
  assert.deepEqual(pair(coded("API_KEY_REVOKED")), [403, "AccessDenied"]);
});

test("⛔ the rest of NMTS's refusals land where a client acts on them sensibly, none of them a retried 500", () => {
  assert.deepEqual(pair(coded("DEPOSIT_FEE_INSUFFICIENT", { status: 402 })), [403, "AccountProblem"]);
  assert.deepEqual(pair(coded("SPONSORED_IDEM_MISMATCH", { status: 409 })), [409, "OperationAborted"]);
  assert.deepEqual(pair(coded("SPONSORED_STATE", { status: 409 })), [409, "OperationAborted"]);
  assert.deepEqual(pair(coded("VERSION_CONFLICT", { status: 409 })), [409, "OperationAborted"]);
  // CREDITS_SHORT is a 409 on the wire; its code says more than its status.
  assert.deepEqual(pair(coded("CREDITS_SHORT", { status: 409 })), [403, "AccountProblem"]);
  assert.deepEqual(pair(coded("VALIDATION", { status: 400 })), [400, "InvalidRequest"]);
  assert.deepEqual(pair(coded("TERMS_VERSION_MISMATCH", { status: 422 })), [400, "InvalidRequest"]);
  assert.deepEqual(pair(coded("NOT_IMPLEMENTED", { status: 501 })), [501, "NotImplemented"]);
  assert.deepEqual(pair(coded("INTERNAL", { status: 500 })), [503, "SlowDown"]);
});

test("⛔ this package refusing its input is 400 InvalidRequest, and says nothing of where the file was", () => {
  const empty = Object.assign(new Error("/tmp/nmts-s3-4242/0b6f/spool is empty."), { exitCode: 4 });
  const badName = Object.assign(new Error('"a/b" names the whole drive, not one thing in it.'), { exitCode: 2 });
  for (const error of [empty, badName]) {
    const answer = answerFor(error);
    assert.deepEqual([answer.status, answer.code], [400, "InvalidRequest"], error.message);
    assert.doesNotMatch(answer.message, /tmp|a\/b/);
  }
  // Exit code 1 is not a refusal of the input: that one stays a 500.
  assert.deepEqual(pair(Object.assign(new Error("x"), { exitCode: 1 })), [500, "InternalError"]);
});

test("⛔ bytes the storage network did not take are 503 SlowDown with Retry-After", () => {
  const pushed = Object.assign(new Error("Uploading to the storage network failed: The upload relay refused the bytes: 502"), {
    phase: "uploading",
    paid: true,
    exitCode: 1,
  });
  const answer = answerFor(pushed);
  assert.deepEqual([answer.status, answer.code, answer.retryAfter], [503, "SlowDown", PUSH_RETRY_AFTER_SECONDS]);
  // A wait the failure named wins over the default.
  assert.equal(answerFor(Object.assign(pushed, { retryAfter: 30 })).retryAfter, 30);
  // Another phase with no status is not a network failure.
  assert.deepEqual(pair(Object.assign(new Error("Could not prepare this file"), { phase: "encoding" })), [500, "InternalError"]);
});

test("⛔ a 500 says S3's own sentence, and the failure's words go to the log, not the client", () => {
  const leak = new Error("ENOENT: no such file or directory, open '/tmp/nmts-s3-4242/9f1c-uuid/part-3'");
  const answer = answerFor(Object.assign(leak, { code: "ENOENT" }));
  assert.deepEqual([answer.status, answer.code], [500, "InternalError"]);
  assert.equal(answer.message, "We encountered an internal error. Please try again.");
  assert.equal(answer.reason, `ENOENT: ${leak.message}`);
  const database = answerFor(new Error('duplicate key value violates unique constraint "buckets_pkey"'));
  assert.doesNotMatch(database.message, /duplicate|constraint/);
});

const drive = await fakeDrive();
await drive.seed("here.txt", "readable");
const source = drive.source();
const logged: string[] = [];
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => {
    if (name === "b") return source;
    if (name === "down") throw new Error("Could not reach https://resolver.example.");
    return null;
  },
  log: (line) => logged.push(line),
});
const HOST = await listening(gateway);
after(() => gateway.close());

test("over a socket: no credits is 403 AccountProblem, and nothing is stored", async () => {
  drive.failNextStore(coded("CREDITS_SHORT", { status: 402 }));
  const res = await send(HOST, "PUT", "/b/new.txt", { body: Buffer.from("x") });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<Code>AccountProblem<\/Code>/);
  assert.equal(drive.textAt("new.txt"), undefined);
});

test("over a socket: a rate limit is 503 SlowDown with Retry-After", async () => {
  drive.failNextStore(coded("RATE_LIMITED", { status: 429, retryAfter: 7 }));
  const res = await send(HOST, "PUT", "/b/new.txt", { body: Buffer.from("x") });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "7");
  assert.match(await res.text(), /<Code>SlowDown<\/Code>/);
});

test("over a socket: an expired delegation is 403 AccessDenied", async () => {
  drive.failNextStore(coded("DELEGATION_EXPIRED", { status: 401 }));
  const res = await send(HOST, "PUT", "/b/new.txt", { body: Buffer.from("x") });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<Code>AccessDenied<\/Code>/);
});

test("over a socket: a read that could not reach the storage network is SlowDown, not a 500", async () => {
  drive.failFetch(new Error("That file could not be read from the testnet storage network."));
  try {
    const res = await send(HOST, "GET", "/b/here.txt");
    assert.equal(res.status, 503);
    assert.match(await res.text(), /<Code>SlowDown<\/Code>/);
  } finally {
    drive.failFetch(null);
  }
  assert.equal((await send(HOST, "GET", "/b/here.txt")).status, 200);
});

test("over a socket: a resolver that could not be reached is SlowDown", async () => {
  const res = await send(HOST, "GET", "/down?list-type=2");
  assert.equal(res.status, 503);
  assert.match(await res.text(), /<Code>SlowDown<\/Code>/);
});

test("over a socket: anything else is 500 InternalError", async () => {
  drive.failNextStore(new Error("something nobody planned for"));
  const res = await send(HOST, "PUT", "/b/new.txt", { body: Buffer.from("x") });
  assert.equal(res.status, 500);
  assert.match(await res.text(), /<Code>InternalError<\/Code>/);
});

test("⛔ over a socket: the client gets a fixed sentence, the log gets why -- without the file's name", async () => {
  drive.failNextStore(new Error("could not seal reports/q3 plan.txt at /tmp/nmts-s3-4242/9f1c/spool"));
  const res = await send(HOST, "PUT", "/b/reports/q3%20plan.txt", { body: Buffer.from("x") });
  const text = await res.text();
  assert.equal(res.status, 500);
  assert.match(text, /<Message>We encountered an internal error\. Please try again\.<\/Message>/);
  assert.doesNotMatch(text, /nmts-s3|seal/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const line = logged.at(-1) ?? "";
  assert.match(line, /^PutObject 500 \(Error: could not seal … at \/tmp\/nmts-s3-4242\/9f1c\/spool\)$/);
  assert.doesNotMatch(line, /q3|plan|reports/);
});

test("over a socket: a refusal the gateway phrased itself adds nothing to the log line", async () => {
  const res = await send(HOST, "GET", "/b/not-here.txt");
  assert.equal(res.status, 404);
  await res.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(logged.at(-1), "GetObject 404");
});
