// How listings order and page, how the query is read, and what a finish's checksum is about.
//
// ⛔ WHY. A listing sorted by UTF-16 code units put emoji before characters UTF-8 puts them after,
//    so a client paging by "after the last key" skipped or repeated keys; `max-keys=0` answered a
//    thousand; a `+` in a query was signed as `+` and answered as a space; and a finish's
//    `x-amz-checksum-*`, which is the whole object's, was held against the XML of the part list.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { checksumOf } from "../src/s3/checksum.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, raw, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const drive = await fakeDrive();
await drive.seed("order/x\u{FFFD}.txt", "bmp");
await drive.seed("order/x\u{1F600}.txt", "astral");
await drive.seed("plus/a+b.txt", "plus");
await drive.seed("plus/a b.txt", "space");
const source = drive.source();
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: () => source });
const HOST = await listening(gateway);
after(() => gateway.close());

const list = async (query: string): Promise<{ status: number; body: string }> => {
  const res = await send(HOST, "GET", `/b?${query}`);
  return { status: res.status, body: await res.text() };
};

test("⛔ a listing is in UTF-8 byte order, and pages by it without skipping a key", async () => {
  const all = await list("list-type=2&prefix=order%2F");
  assert.deepEqual(values(all.body, "Key"), ["order/", "order/x\u{FFFD}.txt", "order/x\u{1F600}.txt"]);
  const first = await list("list-type=2&prefix=order%2F&max-keys=2");
  const token = values(first.body, "NextContinuationToken")[0] ?? "";
  const rest = await list(`list-type=2&prefix=order%2F&continuation-token=${encodeURIComponent(token)}`);
  assert.deepEqual(values(rest.body, "Key"), ["order/x\u{1F600}.txt"]);
});

test("⛔ max-keys: negative is refused, 0 is no keys, and past 1,000 is 1,000 — echoed as applied", async () => {
  const negative = await list("list-type=2&max-keys=-1");
  assert.equal(negative.status, 400);
  assert.match(negative.body, /<Code>InvalidArgument<\/Code>/);
  assert.equal((await list("list-type=2&max-keys=ten")).status, 400);
  const none = await list("list-type=2&max-keys=0");
  assert.equal(none.status, 200);
  assert.deepEqual(values(none.body, "Key"), []);
  assert.deepEqual(values(none.body, "IsTruncated"), ["false"]);
  assert.deepEqual(values(none.body, "MaxKeys"), ["0"]);
  assert.deepEqual(values((await list("list-type=2&max-keys=5000")).body, "MaxKeys"), ["1000"]);
});

test("⛔ a `+` in the query is the `+` that was signed, not a space", async () => {
  // Signed as a client that encodes `+` signs it, sent with the `+` bare, as some clients send it.
  const signed = sign("GET", "/b?list-type=2&prefix=plus%2Fa%2Bb", HOST, CREDENTIAL, new Date());
  const res = await raw(HOST, "GET", "/b?list-type=2&prefix=plus/a+b", signed.headers);
  assert.equal(res.status, 200);
  assert.deepEqual(values(res.body, "Key"), ["plus/a+b.txt"]);
});

async function begin(key: string): Promise<string> {
  const res = await send(HOST, "POST", `/b/${key}?uploads=`);
  return values(await res.text(), "UploadId")[0] ?? "";
}

test("⛔ ListMultipartUploads pages over common prefixes, and resumes after an upload that is gone", async () => {
  const a = await begin("up/a.bin");
  const deep = await begin("up/deep/b.bin");
  const deeper = await begin("up/deep/c.bin");
  const first = await begin("up/z.bin");
  const second = await begin("up/z.bin");
  const page = await list("uploads&prefix=up%2F&delimiter=%2F&max-uploads=2");
  assert.deepEqual(values(page.body, "Key"), ["up/a.bin"]);
  assert.deepEqual(values(page.body, "NextKeyMarker"), ["up/deep/"], "the marker is not the prefix the page ended on");
  const next = await list("uploads&prefix=up%2F&delimiter=%2F&max-uploads=2&key-marker=up%2Fdeep%2F");
  assert.deepEqual(values(next.body, "Key"), ["up/z.bin", "up/z.bin"], "the prefix's uploads came back as new");

  // The marker names an upload finished or aborted since: the key's later upload is still listed.
  await send(HOST, "DELETE", `/b/up/z.bin?uploadId=${first}`);
  const resumed = await list(`uploads&prefix=up%2Fz&key-marker=up%2Fz.bin&upload-id-marker=${first}`);
  assert.deepEqual(values(resumed.body, "UploadId"), [second]);
  for (const [key, id] of [
    ["up/a.bin", a],
    ["up/deep/b.bin", deep],
    ["up/deep/c.bin", deeper],
    ["up/z.bin", second],
  ]) {
    await send(HOST, "DELETE", `/b/${key}?uploadId=${id}`);
  }
});

async function finish(key: string, id: string, tags: readonly string[], headers: Record<string, string>): Promise<Response> {
  const list = tags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("");
  return await send(HOST, "POST", `/b/${key}?uploadId=${id}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
    headers,
  });
}

test("⛔ a finish's full-object checksum is the object's: checked against the joined file, not the part list", async () => {
  const id = await begin("summed.bin");
  const one = (await send(HOST, "PUT", `/b/summed.bin?partNumber=1&uploadId=${id}`, { body: Buffer.from("first-") })).headers.get("etag") ?? "";
  const two = (await send(HOST, "PUT", `/b/summed.bin?partNumber=2&uploadId=${id}`, { body: Buffer.from("second") })).headers.get("etag") ?? "";
  const wrong = await finish("summed.bin", id, [one, two], {
    "x-amz-checksum-crc32": checksumOf("crc32", Buffer.from("something else")),
    "x-amz-checksum-type": "FULL_OBJECT",
  });
  assert.match(await wrong.text(), /<Code>BadDigest<\/Code>/);
  assert.equal(drive.textAt("summed.bin"), undefined, "a file that did not match its checksum was stored");
  const right = await finish("summed.bin", id, [one, two], {
    "x-amz-checksum-crc32": checksumOf("crc32", Buffer.from("first-second")),
    "x-amz-checksum-type": "FULL_OBJECT",
  });
  assert.equal(right.status, 200);
  assert.match(await right.text(), /<CompleteMultipartUploadResult/);
  assert.equal(drive.textAt("summed.bin"), "first-second");
});

test("⛔ a composite checksum is checked from the parts' own checksums", async () => {
  const id = await begin("composite.bin");
  const pieces = ["alpha-", "beta"];
  const tags: string[] = [];
  const crcs: Buffer[] = [];
  for (const [i, text] of pieces.entries()) {
    const crc = checksumOf("crc32", Buffer.from(text));
    crcs.push(Buffer.from(crc, "base64"));
    const res = await send(HOST, "PUT", `/b/composite.bin?partNumber=${i + 1}&uploadId=${id}`, {
      body: Buffer.from(text),
      headers: { "x-amz-checksum-crc32": crc },
    });
    tags.push(res.headers.get("etag") ?? "");
  }
  const composite = checksumOf("crc32", Buffer.concat(crcs));
  const wrong = await finish("composite.bin", id, tags, { "x-amz-checksum-crc32": `${checksumOf("crc32", Buffer.from("x"))}-2` });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /<Code>BadDigest<\/Code>/);
  const right = await finish("composite.bin", id, tags, { "x-amz-checksum-crc32": `${composite}-2` });
  assert.equal(right.status, 200);
  await right.text();
  assert.equal(drive.textAt("composite.bin"), "alpha-beta");
});
