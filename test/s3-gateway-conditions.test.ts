// Two writes to one key at once, and the conditions a write can put on its key.
//
// ⛔ WHY. Overlapping PUTs to one key decided from the same cached list: under `refuse` the loser
//    was stored as `name (2)` and told 200 with the winner's tag; a client's retry after a timeout
//    stored the same file twice; and `If-None-Match: *` — the one thing a client sends to stop two
//    writers overwriting each other — was ignored and answered 200.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";

const drive = await fakeDrive();
await drive.seed("plans/one.txt", "the first plan");
await drive.seed("source.txt", "copy me");

/** Every store waits this long, so two requests really do overlap. */
let storeDelayMs = 0;
const slow = { ...drive.account };
slow.store = async (local, name, folder, how) => {
  if (storeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, storeDelayMs));
  return await drive.account.store(local, name, folder, how);
};
const refusing = drive.source({ account: slow });
const replacing = drive.source({ account: slow, overwrite: "replace" });
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? refusing : name === "r" ? replacing : null),
});
const HOST = await listening(gateway);
after(() => gateway.close());

const put = (target: string, text: string, headers: Record<string, string> = {}): Promise<Response> =>
  send(HOST, "PUT", target, { body: Buffer.from(text), headers });

test("⛔ two different uploads to one free key: one is stored, the other is refused — never a `(2)`", async () => {
  storeDelayMs = 100;
  try {
    const answers = await Promise.all([put("/b/race.txt", "first bytes"), put("/b/race.txt", "second bytes")]);
    assert.deepEqual(answers.map((r) => r.status).sort(), [200, 409]);
    assert.equal(drive.entries.filter((e) => e.name.startsWith("race")).length, 1, "a numbered duplicate was stored");
    const won = answers.find((r) => r.status === 200);
    assert.equal((await send(HOST, "HEAD", "/b/race.txt")).headers.get("etag"), won?.headers.get("etag"));
  } finally {
    storeDelayMs = 0;
  }
});

test("⛔ under replace, each of two overlapping uploads is answered the tag of its own file", async () => {
  storeDelayMs = 100;
  try {
    const answers = await Promise.all([put("/r/both.txt", "one"), put("/r/both.txt", "two")]);
    assert.deepEqual(answers.map((r) => r.status), [200, 200]);
    const tags = answers.map((r) => r.headers.get("etag"));
    assert.notEqual(tags[0], tags[1], "both were told the tag of one file");
    // Whichever landed last is what the key holds, and its client was told exactly that tag.
    const now = (await send(HOST, "HEAD", "/r/both.txt")).headers.get("etag");
    assert.ok(tags.includes(now), "the key holds a file neither client was told about");
  } finally {
    storeDelayMs = 0;
  }
});

test("⛔ a retry of the same bytes while the first is still storing waits, and is answered unchanged", async () => {
  storeDelayMs = 150;
  try {
    const before = drive.stores.length;
    const [first, retry] = await Promise.all([put("/b/retried.txt", "same bytes"), put("/b/retried.txt", "same bytes")]);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(first.headers.get("etag"), retry.headers.get("etag"));
    assert.equal(drive.stores.length - before, 1, "the same file was stored twice");
  } finally {
    storeDelayMs = 0;
  }
});

test("⛔ If-None-Match: * stores only onto a free key; of two at once, exactly one wins", async () => {
  const taken = await put("/b/plans/one.txt", "anything", { "if-none-match": "*" });
  assert.equal(taken.status, 412);
  assert.match(await taken.text(), /<Code>PreconditionFailed<\/Code>/);
  storeDelayMs = 100;
  try {
    const answers = await Promise.all([
      put("/r/once.txt", "a", { "if-none-match": "*" }),
      put("/r/once.txt", "b", { "if-none-match": "*" }),
    ]);
    assert.deepEqual(answers.map((r) => r.status).sort(), [200, 412]);
  } finally {
    storeDelayMs = 0;
  }
});

test("⛔ If-Match stores only over the tag it names: 412 for another, 404 for no file", async () => {
  const tag = (await send(HOST, "HEAD", "/r/plans/one.txt")).headers.get("etag") ?? "";
  assert.equal((await put("/r/plans/one.txt", "second plan", { "if-match": '"0000"' })).status, 412);
  assert.equal((await put("/r/nothing-here.txt", "x", { "if-match": tag })).status, 404);
  const matched = await put("/r/plans/one.txt", "second plan", { "if-match": tag });
  assert.equal(matched.status, 200);
  assert.equal(drive.textAt("plans/one.txt"), "second plan");
});

test("⛔ a condition this gateway cannot honour is 501, never ignored", async () => {
  assert.equal((await put("/b/x.txt", "x", { "if-none-match": '"abc"' })).status, 501);
  assert.equal((await put("/b/x.txt", "x", { "if-modified-since": new Date().toUTCString() })).status, 501);
  assert.equal((await send(HOST, "DELETE", "/b/source.txt", { headers: { "if-none-match": "*" } })).status, 501);
  assert.equal(drive.textAt("x.txt"), undefined);
});

test("⛔ a finish with If-None-Match: * onto a taken key is 412 before anything is stored", async () => {
  const begun = await send(HOST, "POST", "/b/plans/one.txt?uploads=");
  const id = values(await begun.text(), "UploadId")[0] ?? "";
  const part = await put(`/b/plans/one.txt?partNumber=1&uploadId=${id}`, "pieces");
  const list = `<Part><PartNumber>1</PartNumber><ETag>${part.headers.get("etag") ?? ""}</ETag></Part>`;
  const before = drive.stores.length;
  const done = await send(HOST, "POST", `/b/plans/one.txt?uploadId=${id}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
    headers: { "if-none-match": "*" },
  });
  assert.equal(done.status, 412);
  assert.equal(drive.stores.length, before);
});

test("⛔ a copy's source conditions are honoured: a tag or a time that does not hold is 412", async () => {
  const head = await send(HOST, "HEAD", "/b/source.txt");
  const tag = head.headers.get("etag") ?? "";
  const changed = Date.parse(head.headers.get("last-modified") ?? "");
  const copy = (headers: Record<string, string>): Promise<Response> =>
    send(HOST, "PUT", "/b/copied.txt", { headers: { "x-amz-copy-source": "b/source.txt", ...headers } });
  assert.equal((await copy({ "x-amz-copy-source-if-match": '"other"' })).status, 412);
  assert.equal((await copy({ "x-amz-copy-source-if-none-match": tag })).status, 412);
  assert.equal((await copy({ "x-amz-copy-source-if-unmodified-since": new Date(changed - 60_000).toUTCString() })).status, 412);
  assert.equal((await copy({ "x-amz-copy-source-if-modified-since": new Date(changed + 60_000).toUTCString() })).status, 412);
  assert.equal(drive.textAt("copied.txt"), undefined);
  const matched = await copy({ "x-amz-copy-source-if-match": tag });
  assert.equal(matched.status, 200);
  await matched.text();
  assert.equal(drive.textAt("copied.txt"), "copy me");
});

// ⛔ S3 TAKES A COPY ONTO ITSELF THAT CHANGES ONLY THE STORAGE CLASS. The refusal that answered it
//    claimed the class had not changed, and a tool moving objects between classes stopped there.
test("a copy onto itself that names a storage class is accepted, and nothing is stored", async () => {
  const before = drive.stores.length;
  const res = await send(HOST, "PUT", "/b/source.txt", {
    headers: { "x-amz-copy-source": "b/source.txt", "x-amz-storage-class": "GLACIER" },
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<CopyObjectResult/);
  assert.equal(drive.stores.length, before);
});
