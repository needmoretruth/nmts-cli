// Which keys a drive can hold, folders as their markers, empty objects, and a name the trash holds.
//
// ⛔ WHY. A key the drive stored under another path — `/x` as `x`, `photos` as `photos (2)` when a
//    folder had the name, `report.pdf` as `report (2).pdf` when the old one was in the trash — was
//    answered 500 "stored but not shown", and every retry of it stored, and paid for, another copy.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { EMPTY_ETAG } from "../src/s3/listing.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, raw, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const drive = await fakeDrive();
await drive.seed("photos/beach.jpg", "a beach");
await drive.seed("café.txt".normalize("NFC"), "composed");
const refusing = drive.source();
const replacing = drive.source({ overwrite: "replace" });
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? refusing : name === "r" ? replacing : null),
});
const HOST = await listening(gateway);
after(() => gateway.close());

/** A PUT whose path is sent exactly as written, not tidied by a URL parser. */
async function putRaw(path: string, text: string): Promise<{ status: number; body: string }> {
  const body = Buffer.from(text);
  const signed = sign("PUT", path, HOST, CREDENTIAL, new Date(), body);
  return await raw(HOST, "PUT", path, { ...signed.headers, "content-length": String(body.length) }, body);
}

test("⛔ a key the drive cannot hold is a 400 a client does not retry, and nothing is stored", async () => {
  const before = drive.stores.length;
  for (const path of ["/b//lead.txt", "/b/a//b.txt", "/b/a/./b.txt", "/b/a/../b.txt", "/b/%20/x.txt", "/b/tab%09.txt"]) {
    const res = await putRaw(path, "x");
    assert.equal(res.status, 400, path);
    assert.match(res.body, /<Code>InvalidArgument<\/Code>/, path);
  }
  const long = await putRaw(`/b/${"k".repeat(1025)}`, "x");
  assert.equal(long.status, 400);
  assert.match(long.body, /<Code>KeyTooLongError<\/Code>/);
  assert.equal(drive.stores.length, before, "a key the drive cannot hold reached the store");
});

test("⛔ a key that names a folder is a conflict, not a file stored as `photos (2)`", async () => {
  const before = drive.stores.length;
  const res = await send(HOST, "PUT", "/b/photos", { body: Buffer.from("not a folder") });
  assert.equal(res.status, 409);
  assert.match(await res.text(), /A folder is already at photos/);
  const inside = await send(HOST, "PUT", "/b/photos/beach.jpg/x.txt", { body: Buffer.from("x") });
  assert.equal(inside.status, 409, "a file became a folder's parent");
  assert.equal(drive.stores.length, before);
  assert.equal(drive.entries.filter((e) => e.name.startsWith("photos (")).length, 0);
});

test("⛔ the other spelling of a name is the same key: refused, not stored beside it", async () => {
  const decomposed = "café.txt".normalize("NFD");
  const res = await send(HOST, "PUT", `/b/${encodeURIComponent(decomposed)}`, { body: Buffer.from("decomposed") });
  assert.equal(res.status, 409);
  assert.match(await res.text(), /accents written the other way/);
  assert.equal(drive.entries.filter((e) => e.name.normalize("NFC") === "café.txt").length, 1);
});

test("⛔ under replace, the other spelling replaces the file and says it did", async () => {
  await drive.seed("résumé.txt".normalize("NFC"), "old");
  const decomposed = "résumé.txt".normalize("NFD");
  const res = await send(HOST, "PUT", `/r/${encodeURIComponent(decomposed)}`, { body: Buffer.from("new") });
  assert.equal(res.status, 200);
  assert.equal(drive.textAt(decomposed), "new");
  assert.equal(drive.textAt("résumé.txt".normalize("NFC")), undefined, "two files a person cannot tell apart");
});

test("a zero-byte PUT to a key ending in `/` makes the folder, and HEAD, GET and a listing agree", async () => {
  const made = await send(HOST, "PUT", "/b/new/deeper/", {});
  assert.equal(made.status, 200);
  assert.equal(made.headers.get("etag"), EMPTY_ETAG);
  assert.ok(drive.entries.some((e) => e.kind === 0 && e.name === "deeper"), "no folder was made");
  const head = await send(HOST, "HEAD", "/b/new/deeper/");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("etag"), EMPTY_ETAG);
  assert.equal(head.headers.get("content-length"), "0");
  const got = await send(HOST, "GET", "/b/new/deeper/");
  assert.equal(got.status, 200);
  assert.equal((await got.arrayBuffer()).byteLength, 0);
  const listed = await (await send(HOST, "GET", "/b?list-type=2&prefix=new%2F")).text();
  assert.deepEqual(values(listed, "Key"), ["new/", "new/deeper/"]);
  // Made again, it is already there.
  assert.equal((await send(HOST, "PUT", "/b/new/deeper/", {})).status, 200);
});

test("⛔ bytes sent to a folder key are refused as 400; an empty object that is not a folder is stored", async () => {
  const before = drive.stores.length;
  const folder = await send(HOST, "PUT", "/b/stuff/", { body: Buffer.from("bytes") });
  assert.equal(folder.status, 400);
  assert.equal(drive.stores.length, before);
  const empty = await send(HOST, "PUT", "/b/empty.txt", {});
  assert.equal(empty.status, 200);
  assert.equal(drive.stores.length, before + 1);
  const got = await send(HOST, "GET", "/b/empty.txt");
  assert.equal(got.status, 200);
  assert.equal((await got.arrayBuffer()).byteLength, 0);
});

test("⛔ a key whose old file is in the trash is free: the new file takes the name, the old one moves aside", async () => {
  await drive.seed("report.pdf", "the first report");
  assert.equal((await send(HOST, "DELETE", "/b/report.pdf")).status, 204);
  const res = await send(HOST, "PUT", "/b/report.pdf", { body: Buffer.from("the second report") });
  assert.equal(res.status, 200);
  assert.equal(drive.textAt("report.pdf"), "the second report");
  const inTrash = drive.entries.filter((e) => e.deletedAt !== undefined && e.name.startsWith("report"));
  assert.deepEqual(inTrash.map((e) => e.name), ["report (2).pdf"], "the trashed file was not moved aside");
  // A retry of the same upload is the same file, not another copy.
  const before = drive.stores.length;
  const again = await send(HOST, "PUT", "/b/report.pdf", { body: Buffer.from("the second report") });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("etag"), res.headers.get("etag"));
  assert.equal(drive.stores.length, before);
});
