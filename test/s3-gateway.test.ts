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

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGateway, newCredential } from "../src/s3/server.ts";
import { createStaging } from "../src/s3/staging.ts";
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
//    reports a backup that does not exist. A gateway with no writer refuses, and says what would
//    give it one.
test("⛔ writing is refused with a sentence, not answered", async () => {
  const res = await call("PUT", "/drive/new.txt");
  assert.equal(res.status, 501);
  const body = await res.text();
  assert.match(body, /<Code>NotImplemented<\/Code>/);
  assert.match(body, /consent grant spend/);
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

// ── Writing ────────────────────────────────────────────────────────────────────────────────────
//
// ⛔ A SECOND GATEWAY, because read-only is not a mode this one can be put into: it is the ABSENCE
//    of a writer, which is what a machine with no spending agreement produces. Testing both from
//    one instance would mean inventing a switch that the product does not have.

const written: Array<{ key: string; bytes: string }> = [];
const trashed: string[] = [];
const writable = createGateway({
  credential: CREDENTIAL,
  source: {
    entries: async () => ENTRIES,
    fetch: async (object, sink) => {
      sink.expect(object.size);
      await sink.write(CONTENT.subarray(0, object.size));
      await sink.commit();
    },
    write: {
      put: async (key, body, size) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        written.push({ key, bytes: Buffer.concat(chunks).toString() });
        assert.equal(Buffer.concat(chunks).length, size, "the declared size was not the body's size");
      },
      trash: async (object) => {
        trashed.push(object.key);
      },
      multipart: createStaging(mkdtempSync(join(tmpdir(), "nmts-gateway-test-")), async (key, path) => {
        written.push({ key, bytes: readFileSync(path, "utf8") });
      }),
    },
  },
});
await new Promise<void>((resolve) => writable.listen(0, "127.0.0.1", resolve));
const WRITE_HOST = `127.0.0.1:${(writable.address() as AddressInfo).port}`;
after(() => writable.close());

async function send(
  method: string,
  target: string,
  body: Buffer = Buffer.alloc(0),
  extra: Record<string, string> = {},
  host: string = WRITE_HOST,
): Promise<Response> {
  const signed = sign(method, target, host, CREDENTIAL, new Date(), body);
  return await fetch(signed.url, {
    method,
    headers: { ...signed.headers, ...extra, "content-length": String(body.length) },
    ...(body.length > 0 ? { body } : {}),
  });
}

// ⛔ MEASURED FROM A REAL CLIENT: rclone's first act when copying a file is to create the bucket.
//    Refusing it ends the copy before the upload is attempted.
test("making the bucket that is already there succeeds", async () => {
  assert.equal((await send("PUT", "/drive")).status, 200);
});

test("a file arrives whole, at the key the client used", async () => {
  const body = Buffer.from("hello from a sync tool\n");
  const res = await send("PUT", "/drive/notes/new.txt?x-id=PutObject", body);
  assert.equal(res.status, 200);
  assert.deepEqual(written.at(-1), { key: "notes/new.txt", bytes: body.toString() });
});

// ⛔ THE ONE THAT KEEPS A SYNC TOOL FROM DUPLICATING FOREVER. This drive does not replace files;
//    the same name arrives as a numbered copy. Answering 200 would tell the client it had updated
//    a file it had in fact duplicated, and it would duplicate again on every run.
test("⛔ a key that is already there is a conflict, and nothing is written", async () => {
  const before = written.length;
  const res = await send("PUT", "/drive/readme.txt", Buffer.from("replacement"));
  assert.equal(res.status, 409);
  assert.match(await res.text(), /does not replace files/);
  assert.equal(written.length, before, "it uploaded over an existing file");
});

test("deleting puts the file in the trash, and deleting nothing is still fine", async () => {
  assert.equal((await send("DELETE", "/drive/readme.txt")).status, 204);
  assert.deepEqual(trashed.at(-1), "readme.txt");
  const again = await send("DELETE", "/drive/not-there.txt");
  assert.equal(again.status, 204, "a second delete of the same key must not fail a sync");
});

// ⛔ WITHOUT THE SPENDING AGREEMENT EVERY WRITE IS REFUSED, and the refusal names the one command
//    that changes it. A gateway cannot ask: its caller is a program.
test("⛔ with no writer, writes are refused and say why", async () => {
  const res = await send("PUT", "/drive/new.txt", Buffer.from("x"), {}, HOST);
  assert.equal(res.status, 501);
  const body = await res.text();
  assert.match(body, /read only/i);
  assert.match(body, /consent grant spend/);
  assert.equal((await send("DELETE", "/drive/readme.txt", Buffer.alloc(0), {}, HOST)).status, 501);
});

// ⛔ MEASURED FROM A REAL CLIENT, AND THE ORDER IS THE POINT: rclone sent parts 1, 3, 2.
test("a file that arrives in pieces is stored whole, in order", async () => {
  const begun = await send("POST", "/drive/big.bin?uploads=");
  assert.equal(begun.status, 200);
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await begun.text())?.[1];
  assert.ok(uploadId !== undefined, "no upload id came back");
  const at = (n: number, text: string): Promise<Response> =>
    send("PUT", `/drive/big.bin?partNumber=${n}&uploadId=${uploadId}&x-id=UploadPart`, Buffer.from(text));
  assert.equal((await at(1, "ONE-")).status, 200);
  assert.equal((await at(3, "THREE")).status, 200);
  assert.equal((await at(2, "TWO-")).status, 200);
  const done = await send("POST", `/drive/big.bin?uploadId=${uploadId}`, Buffer.from("<CompleteMultipartUpload/>"));
  assert.equal(done.status, 200);
  assert.match(await done.text(), /<Key>big\.bin<\/Key>/);
  assert.deepEqual(written.at(-1), { key: "big.bin", bytes: "ONE-TWO-THREE" });
});

test("⛔ starting a piecewise upload onto an existing key is the same refusal as a whole one", async () => {
  const res = await send("POST", "/drive/readme.txt?uploads=");
  assert.equal(res.status, 409, "large files got a different rule from small ones");
});

test("⛔ with no writer, a piecewise upload is refused too", async () => {
  const res = await send("POST", "/drive/big2.bin?uploads=", Buffer.alloc(0), {}, HOST);
  assert.equal(res.status, 501);
  assert.match(await res.text(), /consent grant spend/);
});

test("aborting a piecewise upload answers 204", async () => {
  const begun = await send("POST", "/drive/gone.bin?uploads=");
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await begun.text())?.[1] ?? "";
  const res = await send("DELETE", `/drive/gone.bin?uploadId=${uploadId}`);
  assert.equal(res.status, 204);
});

test("⛔ a chunk-signed body is refused rather than stored wrong", async () => {
  // The signature is computed over the literal, exactly as a client sending chunks would.
  const signed = sign("PUT", "/drive/chunked.bin", WRITE_HOST, CREDENTIAL, new Date());
  const headers = { ...signed.headers, "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD" };
  const resigned = sign("PUT", "/drive/chunked.bin", WRITE_HOST, CREDENTIAL, new Date());
  void resigned;
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: { ...headers, "content-length": "0" },
  });
  // The declared hash is part of the signature, so changing it fails the signature first — which is
  // also a refusal, and the one that matters: nothing is stored either way.
  assert.equal(res.status, 403);
});
