// `CopyObject`: a file this gateway can read, stored again at another key — or in another bucket.
//
// ⛔ A COPY USED TO STORE AN EMPTY FILE. The request is a PUT with no body and a header naming the
//    source; read as an upload it is an upload of nothing, and it was answered 200.
//
// ⛔ THE SOURCE BUCKET IS ASKED ABOUT LIKE THE DESTINATION. A copy is a read; a pair held to one
//    bucket must not be able to read another's file by copying it into its own.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { createGateway, newCredential } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";

const mine = await fakeDrive();
await mine.seed("docs/report.pdf", "the report's bytes");
await mine.seed("same.txt", "unchanged");
const theirs = await fakeDrive();
await theirs.seed("shared/photo.jpg", "a photo");
const mineSource = mine.source();
const theirSource = theirs.source();
const HELD = { ...newCredential(), buckets: ["mine"] };
const gateway = createGateway({
  credentials: [CREDENTIAL, HELD],
  bucketOf: (name) => (name === "mine" ? mineSource : name === "theirs" ? theirSource : null),
});
const HOST = await listening(gateway);
after(() => gateway.close());

const copy = (target: string, from: string, headers: Record<string, string> = {}, credential = CREDENTIAL): Promise<Response> =>
  send(HOST, "PUT", target, { headers: { "x-amz-copy-source": from, ...headers }, credential });

test("a copy stores the source's bytes at the new key and answers the tag HEAD does", async () => {
  const res = await copy("/mine/archive/report-2026.pdf", "/mine/docs/report.pdf");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(mine.textAt("archive/report-2026.pdf"), "the report's bytes");
  const head = await send(HOST, "HEAD", "/mine/archive/report-2026.pdf");
  assert.deepEqual(values(body, "ETag"), [head.headers.get("etag") ?? ""]);
  assert.match(values(body, "LastModified")[0] ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("the source may be percent-encoded, without a leading slash, and in another bucket", async () => {
  const res = await copy("/mine/from-them.jpg", encodeURIComponent("theirs/shared/photo.jpg"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<CopyObjectResult /);
  assert.equal(mine.textAt("from-them.jpg"), "a photo");
});

test("⛔ a pair held to one bucket cannot copy out of another — nor learn whether it exists", async () => {
  const before = mine.stores.length;
  const res = await copy("/mine/stolen.jpg", "theirs/shared/photo.jpg", {}, HELD);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<Code>AccessDenied<\/Code>/);
  const nowhere = await copy("/mine/stolen.jpg", "no-such-bucket/x", {}, HELD);
  assert.equal(nowhere.status, 403);
  assert.equal(mine.stores.length, before);
});

test("a source that is not there is NoSuchKey or NoSuchBucket", async () => {
  assert.match(await (await copy("/mine/x", "mine/nothing-here")).text(), /<Code>NoSuchKey<\/Code>/);
  assert.match(await (await copy("/mine/x", "nowhere/x")).text(), /<Code>NoSuchBucket<\/Code>/);
  assert.match(await (await copy("/mine/x", "just-a-bucket")).text(), /<Code>InvalidArgument<\/Code>/);
});

test("⛔ a copy of one version is refused: this gateway keeps none", async () => {
  const res = await copy("/mine/v.pdf", "mine/docs/report.pdf?versionId=abc");
  assert.equal(res.status, 501);
});

test("a copy onto itself with REPLACE stores nothing and answers the file as it stands", async () => {
  const before = mine.stores.length;
  const head = await send(HOST, "HEAD", "/mine/same.txt");
  const res = await copy("/mine/same.txt", "mine/same.txt", { "x-amz-metadata-directive": "REPLACE", "content-type": "text/csv" });
  assert.equal(res.status, 200);
  assert.deepEqual(values(await res.text(), "ETag"), [head.headers.get("etag") ?? ""]);
  assert.equal(mine.stores.length, before);
  const plain = await copy("/mine/same.txt", "mine/same.txt");
  assert.equal(plain.status, 400, "a copy onto itself that changes nothing is S3's InvalidRequest");
});

// ⚠ The refusal is an upload's, 409 `InvalidRequest`: only the fetched bytes can decide it, and it
//   is decided inside the first keep-alive interval, before any 200 has begun (`long-answer.ts`).
test("⛔ a copy onto a taken key follows the drive's overwrite rule, like any upload", async () => {
  const res = await copy("/mine/docs/report.pdf", "theirs/shared/photo.jpg");
  assert.equal(res.status, 409);
  const body = await res.text();
  assert.deepEqual(values(body, "Code"), ["InvalidRequest"]);
  assert.equal(mine.textAt("docs/report.pdf"), "the report's bytes");
});

test("what the client said about the copy reaches the store only when it replaces the metadata", async () => {
  const keep = await copy("/mine/c1.pdf", "mine/docs/report.pdf", { "content-type": "text/plain", "x-amz-storage-class": "onezone_ia" });
  await keep.text();
  assert.deepEqual(mine.stores.at(-1)?.meta, { storageClass: "ONEZONE_IA", contentType: null });
  const replace = await copy("/mine/c2.pdf", "mine/docs/report.pdf", { "content-type": "text/plain", "x-amz-metadata-directive": "REPLACE" });
  await replace.text();
  assert.deepEqual(mine.stores.at(-1)?.meta, { storageClass: null, contentType: "text/plain" });
});

test("⛔ copying into a part is refused rather than storing an empty part", async () => {
  const begun = await send(HOST, "POST", "/mine/big.bin?uploads=");
  const uploadId = values(await begun.text(), "UploadId")[0] ?? "";
  const res = await copy(`/mine/big.bin?partNumber=1&uploadId=${uploadId}`, "mine/docs/report.pdf");
  assert.equal(res.status, 501);
  assert.match(await res.text(), /UploadPartCopy/);
});
