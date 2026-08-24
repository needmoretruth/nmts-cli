// The local S3 gateway, driven over real HTTP by a signed client.
//
// ⛔ REAL SOCKETS, NOT A CALLED HANDLER. What an S3 client sends is a request line, headers and a
//    signature over both; a test that calls the handler with a hand-built object gets to skip the
//    part where Node parses the target, lower-cases the headers and hands over `req.url` in a shape
//    the signature has to match exactly. That parsing is where a gateway goes wrong.
//
// ⚠ The file bytes are stubbed. What the account really holds and how it is decrypted is tested
//   where that code lives; here the question is whether the protocol in front of it is right.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";

import { createGateway, newCredential } from "../src/s3/server.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { sign } from "./s3-sign.ts";

const CREDENTIAL = newCredential();
const CONTENT = Buffer.from("the bytes of a file that lives in the drive");

function file(id: string, name: string, parentId: string | null, size: number): ManifestEntry {
  return {
    id,
    parentId,
    kind: 1,
    name,
    size,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    dekWrapped: "not-opened-in-this-test",
  };
}

function folder(id: string, name: string, parentId: string | null): ManifestEntry {
  return { id, parentId, kind: 0, name, size: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };
}

const ENTRIES: readonly ManifestEntry[] = [
  folder("f1", "photos", null),
  folder("f2", "2026", "f1"),
  folder("f3", "empty", null),
  file("i1", "readme.txt", null, CONTENT.length),
  file("i2", "a.jpg", "f1", 11),
  file("i3", "b.jpg", "f2", 22),
  { ...file("i4", "gone.txt", null, 5), deletedAt: 1_700_000_400_000 },
  { ...file("i5", "inside-trashed-folder.txt", "f4", 5) },
  { ...folder("f4", "thrown-away", null), deletedAt: 1_700_000_400_000 },
];

const gateway = createGateway({
  credential: CREDENTIAL,
  source: {
    entries: async () => ENTRIES,
    fetch: async (object, sink) => {
      sink.expect(object.size);
      await sink.write(CONTENT.subarray(0, object.size));
      await sink.commit();
    },
  },
});

await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
const address = gateway.address() as AddressInfo;
const HOST = `127.0.0.1:${address.port}`;
after(() => gateway.close());

async function call(method: string, target: string, when: Date = new Date()): Promise<Response> {
  const signed = sign(method, target, HOST, CREDENTIAL, when);
  return await fetch(signed.url, { method: signed.method, headers: signed.headers });
}

test("the drive comes back as one bucket", async () => {
  const res = await call("GET", "/");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<Name>drive<\/Name>/);
});

test("a listing shows the top of the drive: files here, folders as prefixes", async () => {
  const res = await call("GET", "/drive?list-type=2&delimiter=%2F&prefix=&max-keys=1000");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<Key>readme\.txt<\/Key>/);
  assert.match(body, /<Prefix>photos\/<\/Prefix>/);
  // ⛔ A folder holding no files is still a folder in this drive.
  assert.match(body, /<Prefix>empty\/<\/Prefix>/);
  // Nothing below the top level is listed when a delimiter was given.
  assert.doesNotMatch(body, /photos\/a\.jpg/);
});

test("⛔ the trash is not part of the drive, inherited or not", async () => {
  const body = await (await call("GET", "/drive?list-type=2&max-keys=1000")).text();
  assert.doesNotMatch(body, /gone\.txt/, "a trashed file was listed");
  assert.doesNotMatch(body, /inside-trashed-folder/, "a file under a trashed folder was listed");
  assert.doesNotMatch(body, /thrown-away/, "a trashed folder was listed");
});

test("a flat listing names every live file by its whole path", async () => {
  const body = await (await call("GET", "/drive?list-type=2&max-keys=1000")).text();
  for (const key of ["readme.txt", "photos/a.jpg", "photos/2026/b.jpg"]) {
    assert.match(body, new RegExp(`<Key>${key.replace(/[./]/g, "\\$&")}</Key>`));
  }
});

test("paging hands back a cursor and continues from it", async () => {
  const first = await (await call("GET", "/drive?list-type=2&max-keys=1")).text();
  assert.match(first, /<IsTruncated>true<\/IsTruncated>/);
  const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(first)?.[1];
  assert.ok(token !== undefined, "a truncated listing gave no cursor");
  const second = await (
    await call("GET", `/drive?list-type=2&max-keys=1&continuation-token=${encodeURIComponent(token)}`)
  ).text();
  assert.notEqual(
    /<Key>([^<]+)<\/Key>/.exec(first)?.[1],
    /<Key>([^<]+)<\/Key>/.exec(second)?.[1],
    "the second page repeated the first",
  );
});

test("HEAD answers with the size and the tag, and no body", async () => {
  const res = await call("HEAD", "/drive/readme.txt");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(CONTENT.length));
  // ⛔ The tag must not look like an MD5, or clients check downloads against it and call them broken.
  assert.match(res.headers.get("etag") ?? "", /-1"$/);
});

test("GET hands over the file's bytes", async () => {
  const res = await call("GET", "/drive/readme.txt");
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), CONTENT.toString());
});

test("⛔ a file that is not in the list is 404, not an empty 200", async () => {
  const res = await call("GET", "/drive/nowhere.txt");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<Code>NoSuchKey<\/Code>/);
});

test("⛔ another bucket name is refused rather than served", async () => {
  const res = await call("GET", "/somebody-elses-bucket?list-type=2");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<Code>NoSuchBucket<\/Code>/);
});

test("⛔ an unsigned request gets nothing", async () => {
  const res = await fetch(`http://${HOST}/drive?list-type=2`);
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.match(body, /<Code>AccessDenied<\/Code>/);
  assert.doesNotMatch(body, /readme/, "a refusal leaked what is in the drive");
});

test("⛔ a signature made with another secret gets nothing", async () => {
  const other = { accessKeyId: CREDENTIAL.accessKeyId, secretAccessKey: "0000000000000000000000000000" };
  const signed = sign("GET", "/drive?list-type=2", HOST, other, new Date());
  const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<Code>SignatureDoesNotMatch<\/Code>/);
});

// ⛔ THE ONE THAT KEEPS A BACKUP HONEST. A sync tool that gets 200 for a PUT it never performed
//    reports a backup that does not exist. Until uploads are built the answer has to be a refusal.
test("⛔ writing is refused with a sentence, not answered", async () => {
  const res = await call("PUT", "/drive/new.txt");
  assert.equal(res.status, 501);
  const body = await res.text();
  assert.match(body, /<Code>NotImplemented<\/Code>/);
  assert.match(body, /not built yet/);
  const gone = await call("DELETE", "/drive/readme.txt");
  assert.equal(gone.status, 501);
});

// ⛔ THE RULE THIS FILE IS HERE TO KEEP, WRITTEN AS A TEST. The gateway is one signature away from
//    every file in the account, and that signature's key was printed on a terminal. Bound anywhere
//    but loopback it becomes the whole lock. Adding a way to change the address is a decision
//    somebody may argue for one day; this makes it a decision they have to argue for, rather than
//    a line they can add.
test("⛔ there is no way to serve this to anybody else", async () => {
  const { readFileSync } = await import("node:fs");
  const { BIND_ADDRESS } = await import("../src/s3/server.ts");
  assert.equal(BIND_ADDRESS, "127.0.0.1");
  const sources = ["../src/s3/server.ts", "../src/commands/s3.ts"].map((rel) =>
    readFileSync(new URL(rel, import.meta.url), "utf8"),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /0\.0\.0\.0|::\s*"|--bind/, "something here can move the address");
    // The only address it listens on is the constant.
    assert.doesNotMatch(source, /listen\((?![^)]*BIND_ADDRESS)[^)]*"[\d.]+"/);
  }
});
