// What a request names: its bucket and key, in the path or in the host, and the sub-resource it asks about.
//
// ⛔ A QUESTION ABOUT A FILE IS NOT THE FILE. Before this, `GET ?acl` answered the file's bytes,
//    `PUT ?tagging` stored the tagging XML AS the file, and `DELETE ?tagging` sent the file to the
//    trash. Every one of those is checked here against a writable drive, where the damage is real.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { SUB_RESOURCES } from "../src/s3/address.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, raw, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const drive = await fakeDrive();
await drive.seed("notes/secret-plans.txt", "keep this");
const source = drive.source();
const lines: string[] = [];
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "mine" ? source : null),
  virtualHostBase: "s3.example.test",
  log: (line) => lines.push(line),
});
const HOST = await listening(gateway);
after(() => gateway.close());
const PORT = HOST.slice(HOST.lastIndexOf(":") + 1);

test("the bucket's location is us-east-1, and versioning was never turned on", async () => {
  const location = await send(HOST, "GET", "/mine?location");
  assert.equal(location.status, 200);
  assert.match(await location.text(), /<LocationConstraint xmlns="[^"]+"\/>/);
  const versioning = await send(HOST, "GET", "/mine?versioning");
  assert.equal(versioning.status, 200);
  assert.match(await versioning.text(), /<VersioningConfiguration xmlns="[^"]+"\/>/);
});

test("⛔ GET ?acl on a file is refused, not answered with the file", async () => {
  const res = await send(HOST, "GET", "/mine/notes/secret-plans.txt?acl");
  assert.equal(res.status, 501);
  const body = await res.text();
  assert.match(body, /<Code>NotImplemented<\/Code>/);
  assert.match(body, /\?acl/);
  assert.doesNotMatch(body, /keep this/);
});

test("⛔ PUT ?tagging stores nothing, and DELETE ?tagging trashes nothing", async () => {
  const stores = drive.stores.length;
  const tagged = await send(HOST, "PUT", "/mine/notes/secret-plans.txt?tagging", {
    body: Buffer.from("<Tagging><TagSet/></Tagging>"),
  });
  assert.equal(tagged.status, 501);
  assert.equal(drive.stores.length, stores, "the tagging XML was stored as the file");
  const untagged = await send(HOST, "DELETE", "/mine/notes/secret-plans.txt?tagging");
  assert.equal(untagged.status, 501);
  assert.deepEqual(drive.trashed, [], "the file was trashed for a question about its tags");
  assert.equal(drive.textAt("notes/secret-plans.txt"), "keep this");
});

test("every sub-resource this gateway does not do is 501, naming it, on the bucket and on a key", async () => {
  const answered = new Set(["location", "versioning", "uploads", "delete"]);
  for (const name of SUB_RESOURCES) {
    if (!answered.has(name)) {
      const bucket = await send(HOST, "GET", `/mine?${name}`);
      assert.equal(bucket.status, 501, name);
      assert.match(await bucket.text(), new RegExp(`\\?${name}`), name);
    }
    if (name === "uploads") continue;
    const key = await send(HOST, "GET", `/mine/notes/secret-plans.txt?${name}`);
    assert.equal(key.status, 501, `${name} on a key`);
  }
  assert.deepEqual(drive.trashed, []);
});

test("parameters that are not sub-resources do not stop a read", async () => {
  const res = await send(HOST, "GET", "/mine/notes/secret-plans.txt?x-id=GetObject&response-cache-control=no-cache");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "keep this");
});

test("⛔ a malformed percent-encoding in the path is 400 InvalidURI, not a 500", async () => {
  const res = await send(HOST, "GET", "/mine/bad%E0%A4%A");
  assert.equal(res.status, 400);
  assert.match(await res.text(), /<Code>InvalidURI<\/Code>/);
});

test("a virtual-hosted request names its bucket in the host and its key in the whole path", async () => {
  const host = `mine.s3.example.test:${PORT}`;
  const signed = sign("GET", "/notes/secret-plans.txt", host, CREDENTIAL, new Date());
  const res = await raw(HOST, "GET", "/notes/secret-plans.txt", signed.headers);
  assert.equal(res.status, 200);
  assert.equal(res.body, "keep this");

  const listed = sign("GET", "/?list-type=2", host, CREDENTIAL, new Date());
  const listing = await raw(HOST, "GET", "/?list-type=2", listed.headers);
  assert.equal(listing.status, 200);
  assert.deepEqual(values(listing.body, "Name"), ["mine"]);
  assert.deepEqual(values(listing.body, "Key"), ["notes/", "notes/secret-plans.txt"]);
});

test("a host that is the base itself, or another host, is path style", async () => {
  const base = `s3.example.test:${PORT}`;
  const signed = sign("GET", "/mine/notes/secret-plans.txt", base, CREDENTIAL, new Date());
  assert.equal((await raw(HOST, "GET", "/mine/notes/secret-plans.txt", signed.headers)).body, "keep this");
  const other = sign("GET", "/mine?list-type=2", `mine.elsewhere.test:${PORT}`, CREDENTIAL, new Date());
  const listing = await raw(HOST, "GET", "/mine?list-type=2", other.headers);
  assert.deepEqual(values(listing.body, "Name"), ["mine"]);
});

test("⛔ the log names the operation and the status, never a key or a prefix", async () => {
  lines.length = 0;
  await send(HOST, "GET", "/mine/notes/secret-plans.txt");
  await send(HOST, "GET", "/mine?list-type=2&prefix=notes%2Fsecret");
  await send(HOST, "PUT", "/mine/notes/secret-plans-2.txt", { body: Buffer.from("x") });
  await send(HOST, "DELETE", "/mine/notes/secret-plans-2.txt");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(lines, ["GetObject 200", "ListObjectsV2 200", "PutObject 200", "DeleteObject 204"]);
  for (const line of lines) assert.doesNotMatch(line, /secret|notes/);
});
