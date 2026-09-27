// What one client can make a gateway hold: an object's size, writes at once, and lengths that disagree.
//
// ⛔ WHY. There were no limits: every byte of an upload lands on this machine's disk before it is
//    sealed, so one client with a loop could fill the disk every other account's uploads need.

import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGateway } from "../src/s3/server.ts";
import { spoolBody } from "../src/s3/spool.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";

const drive = await fakeDrive();
await drive.seed("big-source.txt", "0123456789abcdef");
let storeDelayMs = 0;
const slow = { ...drive.account };
slow.store = async (local, name, folder, how) => {
  if (storeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, storeDelayMs));
  return await drive.account.store(local, name, folder, how);
};
const source = drive.source({ account: slow, maxObjectBytes: 10 });
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: () => source, maxConcurrentWrites: 1 });
const HOST = await listening(gateway);
after(() => gateway.close());

const put = (target: string, text: string, headers: Record<string, string> = {}): Promise<Response> =>
  send(HOST, "PUT", target, { body: Buffer.from(text), headers });

test("⛔ an object over maxObjectBytes is EntityTooLarge — a PUT, a part, a finish and a copy's source", async () => {
  const before = drive.stores.length;
  const whole = await put("/b/too-big.txt", "eleven bytes");
  assert.equal(whole.status, 400);
  assert.match(await whole.text(), /<Code>EntityTooLarge<\/Code>/);

  const begun = await send(HOST, "POST", "/b/parts.bin?uploads=");
  const id = values(await begun.text(), "UploadId")[0] ?? "";
  const part = await put(`/b/parts.bin?partNumber=1&uploadId=${id}`, "eleven bytes");
  assert.equal(part.status, 400);
  assert.match(await part.text(), /<Code>EntityTooLarge<\/Code>/);
  // Two parts under the limit that add up past it.
  const one = await put(`/b/parts.bin?partNumber=1&uploadId=${id}`, "123456");
  const two = await put(`/b/parts.bin?partNumber=2&uploadId=${id}`, "789012");
  const list =
    `<Part><PartNumber>1</PartNumber><ETag>${one.headers.get("etag") ?? ""}</ETag></Part>` +
    `<Part><PartNumber>2</PartNumber><ETag>${two.headers.get("etag") ?? ""}</ETag></Part>`;
  const done = await send(HOST, "POST", `/b/parts.bin?uploadId=${id}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
  });
  assert.equal(done.status, 400);
  assert.match(await done.text(), /<Code>EntityTooLarge<\/Code>/);

  const copy = await send(HOST, "PUT", "/b/copy.txt", { headers: { "x-amz-copy-source": "b/big-source.txt" } });
  assert.equal(copy.status, 400);
  assert.match(await copy.text(), /<Code>EntityTooLarge<\/Code>/);
  assert.equal(drive.stores.length, before, "something over the limit reached the store");
});

test("⛔ the spool counts the bytes that arrive, whatever length was declared", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "nmts-limit-")), "spool");
  const body = { stream: Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), size: null, verified: Promise.resolve() };
  await assert.rejects(spoolBody(body, path, { md5: false, limit: 10 }), { code: "EntityTooLarge" });
});

test("⛔ a write past maxConcurrentWrites is 503 SlowDown with Retry-After, and the next one goes through", async () => {
  storeDelayMs = 200;
  try {
    const [first, second] = await Promise.all([
      put("/b/one.txt", "one"),
      new Promise<Response>((resolve) => setTimeout(() => resolve(put("/b/two.txt", "two")), 50)),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 503);
    assert.equal(second.headers.get("retry-after"), "1");
    assert.match(await second.text(), /<Code>SlowDown<\/Code>/);
  } finally {
    storeDelayMs = 0;
  }
  assert.equal((await put("/b/two.txt", "two")).status, 200);
  // Reads are not writes, and are never held to it.
  assert.equal((await send(HOST, "GET", "/b?list-type=2")).status, 200);
});

// ⛔ A PLAIN BODY HAS ONE LENGTH. Two that disagree mean one of them is a lie, and either choice
//    would judge the bytes against a number the client may not have meant.
test("⛔ Content-Length and x-amz-decoded-content-length that disagree on a plain body are refused", async () => {
  const res = await put("/b/lengths.txt", "four", { "x-amz-decoded-content-length": "9" });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /disagree/);
  assert.equal((await put("/b/lengths.txt", "four", { "x-amz-decoded-content-length": "4" })).status, 200);
});
