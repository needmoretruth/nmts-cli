// A long answer whose store settles inside the first keep-alive interval: answered with its own
// status, not an `Error` inside a 200 that the AWS SDKs and botocore would retry. The slow case --
// 200 at once, spaces, then the result -- is in `s3-gateway-long.test.ts`.

import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { gatewayHandler } from "../src/s3/server.ts";
import type { DriveAccount } from "../src/s3/drive.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";

const DECLARATION = `<?xml version="1.0" encoding="UTF-8"?>`;

const drive = await fakeDrive();
await drive.seed("docs/report.pdf", "the report's bytes");
await drive.seed("taken.pdf", "a different file already at this key");

/** Shut: every store waits until the test opens it again. */
let gate: Promise<void> = Promise.resolve();
let open: () => void = () => undefined;

const slow: DriveAccount = {
  ...drive.account,
  store: async (local, name, folder, how) => {
    await gate;
    await drive.account.store(local, name, folder, how);
  },
};
const source = drive.source({ account: slow });
const handler = gatewayHandler({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? source : null),
  keepAliveMs: 5_000,
});
// ⛔ A server in front of the gateway that names every request itself, as a business's does.
const server = createServer((req, res) => {
  if (req.headers["x-test-request-id"] !== undefined) res.setHeader("x-amz-request-id", "FRONT-DOOR-0001");
  handler(req, res);
});
const HOST = await listening(server);
after(() => server.close());

const copy = (to: string, extra: Record<string, string> = {}): Promise<Response> =>
  send(HOST, "PUT", to, { headers: { "x-amz-copy-source": "b/docs/report.pdf", ...extra } });

test("⛔ a store refused in its first moments keeps its own status: the account cannot pay", async () => {
  drive.failNextStore(Object.assign(new Error("out of credits"), { code: "CREDITS_SHORT", status: 409 }));
  const res = await copy("/b/copy-refused.pdf");
  assert.equal(res.status, 403);
  assert.deepEqual(values(await res.text(), "Code"), ["AccountProblem"]);
  assert.equal(drive.textAt("copy-refused.pdf"), undefined);
});

test("⛔ a key that holds another file is 409 when refused at once, not an Error in a 200", async () => {
  const res = await copy("/b/taken.pdf");
  const text = await res.text();
  assert.equal(res.status, 409, text);
  assert.deepEqual(values(text, "Code"), ["InvalidRequest"]);
  assert.equal(drive.textAt("taken.pdf"), "a different file already at this key");
});

test("a store that finishes inside the interval is a plain 200 with the whole document", async () => {
  const res = await copy("/b/copy-fast.pdf");
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.startsWith(`${DECLARATION}<CopyObjectResult`), text.slice(0, 80));
  assert.match(res.headers.get("x-amz-request-id") ?? "", /^[0-9A-F]{16}$/);
  assert.equal(drive.textAt("copy-fast.pdf"), "the report's bytes");
});

test("⛔ a request id already on the response is the one the answer names", async () => {
  const fast = await copy("/b/copy-named.pdf", { "x-test-request-id": "1" });
  await fast.text();
  assert.equal(fast.headers.get("x-amz-request-id"), "FRONT-DOOR-0001");

  // Held past the interval, the 200 begins with the same id, and a failure's document names it too.
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  drive.failNextStore(Object.assign(new Error("The storage network did not answer."), { status: 502 }));
  try {
    const held = copy("/b/copy-held.pdf", { "x-test-request-id": "1" });
    setTimeout(() => open(), 6_000);
    const res = await held;
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-amz-request-id"), "FRONT-DOOR-0001");
    assert.deepEqual(values(text, "Code"), ["SlowDown"]);
    assert.deepEqual(values(text, "RequestId"), ["FRONT-DOOR-0001"]);
    assert.ok(text.endsWith("</Error>"));
  } finally {
    open();
    gate = Promise.resolve();
  }
});
