// A multipart upload as a client drives it: the part list it finishes with, and what it can ask about one.
//
// ⛔ THE LIST IS THE FILE. What gets stored is the parts the finish names, each checked against the
//    tag its piece was answered with; `s3-staging.test.ts` checks the staging directly, and this
//    file checks that the protocol reaches it and answers in S3's words.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { after, test } from "node:test";

import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, readOnly, send, values } from "./s3-gateway-drive.ts";

const drive = await fakeDrive();
const source = drive.source();
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? source : name === "ro" ? readOnly : null),
});
const HOST = await listening(gateway);
after(() => gateway.close());

async function begin(key: string): Promise<string> {
  const res = await send(HOST, "POST", `/b/${key}?uploads`);
  assert.equal(res.status, 200);
  return values(await res.text(), "UploadId")[0] ?? "";
}

async function part(key: string, uploadId: string, n: number, text: string): Promise<string> {
  const res = await send(HOST, "PUT", `/b/${key}?partNumber=${n}&uploadId=${uploadId}`, { body: Buffer.from(text) });
  assert.equal(res.status, 200);
  return res.headers.get("etag") ?? "";
}

function finish(key: string, uploadId: string, parts: ReadonlyArray<[number, string]>): Promise<Response> {
  const list = parts.map(([n, etag]) => `<Part><ETag>${etag}</ETag><PartNumber>${n}</PartNumber></Part>`).join("");
  return send(HOST, "POST", `/b/${key}?uploadId=${uploadId}`, {
    body: Buffer.from(`<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${list}</CompleteMultipartUpload>`),
  });
}

test("a part's tag is the MD5 of its bytes", async () => {
  const id = await begin("md5.bin");
  assert.equal(await part("md5.bin", id, 1, "abc"), `"${createHash("md5").update("abc").digest("hex")}"`);
  await send(HOST, "DELETE", `/b/md5.bin?uploadId=${id}`);
});

test("only the parts the finish names are stored, in the order named", async () => {
  const id = await begin("chosen.bin");
  const one = await part("chosen.bin", id, 1, "one-");
  await part("chosen.bin", id, 2, "left-out-");
  const three = await part("chosen.bin", id, 3, "three");
  const done = await finish("chosen.bin", id, [
    [1, one],
    [3, three],
  ]);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /<CompleteMultipartUploadResult /);
  assert.equal(drive.textAt("chosen.bin"), "one-three");
});

test("⛔ a tag that was not answered for that part is InvalidPart; a list out of order is InvalidPartOrder", async () => {
  const id = await begin("checked.bin");
  const one = await part("checked.bin", id, 1, "a");
  const two = await part("checked.bin", id, 2, "b");
  const wrong = await finish("checked.bin", id, [
    [1, one],
    [2, one],
  ]);
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /<Code>InvalidPart<\/Code>/);
  const missing = await finish("checked.bin", id, [[4, two]]);
  assert.match(await missing.text(), /<Code>InvalidPart<\/Code>/);
  const backwards = await finish("checked.bin", id, [
    [2, two],
    [1, one],
  ]);
  assert.equal(backwards.status, 400);
  assert.match(await backwards.text(), /<Code>InvalidPartOrder<\/Code>/);
  const empty = await send(HOST, "POST", `/b/checked.bin?uploadId=${id}`, { body: Buffer.from("<CompleteMultipartUpload/>") });
  assert.match(await empty.text(), /<Code>MalformedXML<\/Code>/);
  assert.equal(drive.textAt("checked.bin"), undefined, "a refused finish stored something");
});

test("⛔ a finish at a different key than the upload began with is InvalidRequest", async () => {
  const id = await begin("here.bin");
  const one = await part("here.bin", id, 1, "x");
  const res = await finish("there.bin", id, [[1, one]]);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /<Code>InvalidRequest<\/Code>/);
  assert.equal(drive.textAt("there.bin"), undefined);
});

test("⛔ an upload id nobody began is NoSuchUpload, for a part, a finish, an abort and a listing", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  const put = await send(HOST, "PUT", `/b/k?partNumber=1&uploadId=${id}`, { body: Buffer.from("x") });
  assert.equal(put.status, 404);
  assert.match(await put.text(), /<Code>NoSuchUpload<\/Code>/);
  assert.equal((await finish("k", id, [[1, '"x"']])).status, 404);
  assert.equal((await send(HOST, "DELETE", `/b/k?uploadId=${id}`)).status, 404);
  assert.equal((await send(HOST, "GET", `/b/k?uploadId=${id}`)).status, 404);
});

test("⛔ a part number outside 1 to 10000 is refused before its body is read", async () => {
  const id = await begin("numbers.bin");
  for (const n of ["0", "10001", "x"]) {
    const res = await send(HOST, "PUT", `/b/numbers.bin?partNumber=${n}&uploadId=${id}`, { body: Buffer.from("x") });
    assert.equal(res.status, 400, n);
    assert.match(await res.text(), /<Code>InvalidArgument<\/Code>/);
  }
});

test("⛔ a finish whose store fails keeps the parts, and the same finish sent again succeeds", async () => {
  const id = await begin("retried.bin");
  const one = await part("retried.bin", id, 1, "worth keeping");
  drive.failNextStore(Object.assign(new Error("The storage network did not answer."), { status: 502 }));
  const failed = await finish("retried.bin", id, [[1, one]]);
  // The store fails inside the first keep-alive interval, so the failure keeps its own status; one
  // that fails after the 200 began says so in the body (`s3-gateway-long.test.ts`).
  assert.equal(failed.status, 503);
  const said = await failed.text();
  assert.deepEqual(values(said, "Code"), ["SlowDown"], "a store that failed for a moment must read as retry-able");
  const again = await finish("retried.bin", id, [[1, one]]);
  assert.equal(again.status, 200);
  assert.match(await again.text(), /<CompleteMultipartUploadResult /);
  assert.equal(drive.textAt("retried.bin"), "worth keeping");
  const head = await send(HOST, "HEAD", "/b/retried.bin");
  const repeat = await finish("retried.bin", id, [[1, one]]);
  assert.equal(repeat.status, 200, "a finish repeated after it worked must not fail");
  assert.deepEqual(values(await repeat.text(), "ETag"), [head.headers.get("etag") ?? ""]);
});

test("ListParts answers each staged part with its number, tag and size, a page at a time", async () => {
  const id = await begin("listed.bin");
  const tags = [await part("listed.bin", id, 1, "a"), await part("listed.bin", id, 2, "bb"), await part("listed.bin", id, 3, "ccc")];
  const all = await (await send(HOST, "GET", `/b/listed.bin?uploadId=${id}`)).text();
  assert.deepEqual(values(all, "PartNumber"), ["1", "2", "3"]);
  assert.deepEqual(values(all, "ETag"), tags);
  assert.deepEqual(values(all, "Size"), ["1", "2", "3"]);
  const page = await (await send(HOST, "GET", `/b/listed.bin?uploadId=${id}&max-parts=1&part-number-marker=1`)).text();
  assert.deepEqual(values(page, "PartNumber"), ["2"]);
  assert.deepEqual(values(page, "IsTruncated"), ["true"]);
  assert.deepEqual(values(page, "NextPartNumberMarker"), ["2"]);
  await send(HOST, "DELETE", `/b/listed.bin?uploadId=${id}`);
});

test("ListMultipartUploads answers the uploads still open, by key, with prefix and delimiter", async () => {
  const a = await begin("open/a.bin");
  const b = await begin("open/deeper/b.bin");
  const c = await begin("other.bin");
  const all = await (await send(HOST, "GET", "/b?uploads&prefix=open%2F")).text();
  assert.deepEqual(values(all, "Key"), ["open/a.bin", "open/deeper/b.bin"]);
  const grouped = await (await send(HOST, "GET", "/b?uploads&prefix=open%2F&delimiter=%2F")).text();
  assert.deepEqual(values(grouped, "Key"), ["open/a.bin"]);
  assert.deepEqual(values(grouped, "Prefix").slice(1), ["open/deeper/"]);
  const paged = await (await send(HOST, "GET", "/b?uploads&prefix=open%2F&max-uploads=1")).text();
  assert.deepEqual(values(paged, "IsTruncated"), ["true"]);
  assert.deepEqual(values(paged, "Key"), ["open/a.bin"]);
  assert.deepEqual(values(paged, "NextKeyMarker"), ["open/a.bin"]);
  const next = await (await send(HOST, "GET", `/b?uploads&prefix=open%2F&max-uploads=1&key-marker=open%2Fa.bin&upload-id-marker=${a}`)).text();
  assert.deepEqual(values(next, "Key"), ["open/deeper/b.bin"]);
  for (const [key, id] of [
    ["open/a.bin", a],
    ["open/deeper/b.bin", b],
    ["other.bin", c],
  ]) {
    await send(HOST, "DELETE", `/b/${key}?uploadId=${id ?? ""}`);
  }
  const none = await (await send(HOST, "GET", "/b?uploads&prefix=open%2F")).text();
  assert.deepEqual(values(none, "Key"), []);
});

test("a read-only drive has no uploads open, and says so rather than refusing", async () => {
  const res = await send(HOST, "GET", "/ro?uploads");
  assert.equal(res.status, 200);
  assert.deepEqual(values(await res.text(), "UploadId"), []);
});
