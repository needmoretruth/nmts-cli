// A drive that replaces: what every S3 client expects a PUT onto a taken key to do.
//
// ⛔ THE OLD FILE GOES TO THE TRASH, NOT AWAY. `overwrite: "replace"` stores the new bytes and sends
//    what was at the key to the trash for thirty days; identical bytes are still `unchanged`, and
//    nothing is sent for them. The default — refuse — is `s3-gateway-write.test.ts`.
//
// ⛔ AND THE TAG MOVES WITH THE FILE. A listing whose ETag did not change when the file did is how a
//    sync tool decides there is nothing to fetch; every answer here is checked against HEAD and the
//    listing after the write.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { EMPTY_ETAG, etagOf, objectsOf } from "../src/s3/listing.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";

const drive = await fakeDrive();
await drive.seed("docs/plan.txt", "the first plan\n");
await drive.seed("legacy.txt", "stored before hashes were recorded", { hashed: false });
const source = drive.source({ overwrite: "replace" });
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: (name) => (name === "b" ? source : null) });
const HOST = await listening(gateway);
after(() => gateway.close());

const tagOf = async (key: string): Promise<string | null> => (await send(HOST, "HEAD", `/b/${key}`)).headers.get("etag");
/** The tag the listing answers for the one file under `prefix` — its folder's marker comes first. */
const listedTag = async (prefix: string): Promise<string | undefined> =>
  values(await (await send(HOST, "GET", `/b?list-type=2&prefix=${encodeURIComponent(prefix)}`)).text(), "ETag").find(
    (tag) => tag !== EMPTY_ETAG,
  );

test("different bytes at a taken key replace the file, and the old one goes to the trash", async () => {
  const before = await tagOf("docs/plan.txt");
  const res = await send(HOST, "PUT", "/b/docs/plan.txt", { body: Buffer.from("the second plan\n") });
  assert.equal(res.status, 200);
  assert.equal(drive.textAt("docs/plan.txt"), "the second plan\n");
  assert.equal(drive.stores.at(-1)?.replace, true);
  const trashed = drive.entries.filter((e) => e.name === "plan.txt" && e.deletedAt !== undefined);
  assert.equal(trashed.length, 1, "the old file was not kept in the trash");

  const etag = res.headers.get("etag");
  assert.notEqual(etag, before, "the tag did not change when the file did");
  assert.equal(await tagOf("docs/plan.txt"), etag);
  assert.equal(await listedTag("docs/"), etag);
});

test("⭐ identical bytes are unchanged under replace too: nothing is sent, and the tag stays", async () => {
  const before = drive.stores.length;
  const tag = await tagOf("docs/plan.txt");
  const res = await send(HOST, "PUT", "/b/docs/plan.txt", { body: Buffer.from("the second plan\n") });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("etag"), tag);
  assert.equal(drive.stores.length, before);
});

test("a file with no recorded hash is replaced rather than refused", async () => {
  const res = await send(HOST, "PUT", "/b/legacy.txt", { body: Buffer.from("new") });
  assert.equal(res.status, 200);
  assert.equal(drive.textAt("legacy.txt"), "new");
});

test("⛔ a free key is stored with the overwrite rule, so a file another device just added is not duplicated", async () => {
  await send(HOST, "PUT", "/b/fresh.txt", { body: Buffer.from("fresh") });
  assert.equal(drive.stores.at(-1)?.replace, true);
  assert.equal(drive.entries.filter((e) => e.name.startsWith("fresh.txt (")).length, 0);
});

test("pieces finished onto a taken key replace it the same way", async () => {
  const begun = await send(HOST, "POST", "/b/docs/plan.txt?uploads=");
  const uploadId = values(await begun.text(), "UploadId")[0] ?? "";
  const part = await send(HOST, "PUT", `/b/docs/plan.txt?partNumber=1&uploadId=${uploadId}`, {
    body: Buffer.from("the third plan\n"),
  });
  const list = `<Part><PartNumber>1</PartNumber><ETag>${part.headers.get("etag") ?? ""}</ETag></Part>`;
  const done = await send(HOST, "POST", `/b/docs/plan.txt?uploadId=${uploadId}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
  });
  assert.equal(done.status, 200);
  const answered = values(await done.text(), "ETag")[0];
  assert.equal(drive.textAt("docs/plan.txt"), "the third plan\n");
  assert.equal(answered, await tagOf("docs/plan.txt"));
  assert.equal(answered, await listedTag("docs/"));
});

test("the tag is a hash of the entry: it changes with the id, the time and the size", () => {
  const entry = objectsOf(drive.entries).find((o) => o.key === "docs/plan.txt")?.entry;
  assert.ok(entry !== undefined);
  const tag = etagOf(entry);
  assert.match(tag, /^"[0-9a-f]{32}-1"$/, "the tag must look assembled from parts, never like an MD5");
  assert.notEqual(etagOf({ ...entry, id: `${entry.id}x` }), tag);
  assert.notEqual(etagOf({ ...entry, updatedAt: entry.updatedAt + 1 }), tag);
  assert.notEqual(etagOf({ ...entry, size: entry.size + 1 }), tag);
  // A long id no longer cuts the time off the tag.
  const long = { ...entry, id: "z".repeat(64) };
  assert.notEqual(etagOf(long), etagOf({ ...long, updatedAt: long.updatedAt + 1 }));
});
