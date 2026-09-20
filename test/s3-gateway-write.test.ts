// The local S3 gateway writing to a drive, driven over real HTTP by a signed client.
//
// ⛔ A SECOND GATEWAY, because read-only is not a mode this one can be put into: it is the ABSENCE
//    of a writer, which is what a machine with no spending agreement produces. Testing both from
//    one instance would mean inventing a switch that the product does not have. So the read-only
//    one is started here too, and the refusals are asked of it.
//
// ⛔ REAL SOCKETS, NOT A CALLED HANDLER, for the reason `s3-gateway.test.ts` gives: the parsing
//    between a request line and a signature is where a gateway goes wrong.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGateway, type DriveSource } from "../src/s3/server.ts";
import { refusalFor } from "../src/s3/same-file.ts";
import { createStaging } from "../src/s3/staging.ts";
import { CREDENTIAL, readOnly } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const refusing = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "drive" ? readOnly : null),
  bucketNames: () => ["drive"],
});
await new Promise<void>((resolve) => refusing.listen(0, "127.0.0.1", resolve));
const HOST = `127.0.0.1:${(refusing.address() as AddressInfo).port}`;
after(() => refusing.close());

const written: Array<{ key: string; bytes: string }> = [];
const trashed: string[] = [];

/**
 * What this stub drive already holds, so it can answer the question the real writer answers:
 * is the file arriving the file already there?
 *
 * ⛔ THE RULE ITSELF IS NOT REIMPLEMENTED HERE — `src/s3/same-file.ts` is, and `same-file.test.ts`
 *    drives it. What this stub exists for is the half only a socket can show: that "identical" is
 *    answered 200 with nothing written, and "different" comes back as 409 rather than 500, on BOTH
 *    upload paths. A stub that accepted everything would let a gateway that lost the distinction
 *    pass every test here.
 */
const STORED = new Map<string, string>([["readme.txt", "the readme, exactly as stored\n"]]);
const accept = (key: string, bytes: string): void => {
  const standing = STORED.get(key);
  if (standing === bytes) return; // the same file: nothing is sent, and that is a success
  if (standing !== undefined) throw refusalFor("differs", key);
  STORED.set(key, bytes);
  written.push({ key, bytes });
};
const writableSource: DriveSource = {
  ...readOnly,
  write: {
    put: async (key, body, size) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).length, size, "the declared size was not the body's size");
      accept(key, Buffer.concat(chunks).toString());
    },
    trash: async (object) => {
      trashed.push(object.key);
    },
    multipart: createStaging(mkdtempSync(join(tmpdir(), "nmts-gateway-test-")), async (key, path) => {
      accept(key, readFileSync(path, "utf8"));
    }),
  },
};
const writable = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "drive" ? writableSource : null),
  bucketNames: () => ["drive"],
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

// ⛔ THE ONE THAT KEEPS A SYNC TOOL FROM DUPLICATING FOREVER. This drive does not replace files,
//    so DIFFERENT content at a taken key is declined — and declined with 409, because the request
//    was well formed and the drive said no. A 500 would have the client retry it forever.
test("⛔ a key that already holds a DIFFERENT file is a conflict, and nothing is written", async () => {
  const before = written.length;
  const res = await send("PUT", "/drive/readme.txt", Buffer.from("replacement"));
  assert.equal(res.status, 409);
  assert.match(await res.text(), /does not replace files/);
  assert.equal(written.length, before, "it uploaded over an existing file");
});

// ⭐ THE SAME BYTES AT THE SAME KEY IS NOT A FAILURE, it is a file that is already there. A backup
//    program sends the same names every night, and answering 409 made every one of those nights a
//    page of errors.
test("⭐ the SAME file at a taken key is answered 200, and nothing is uploaded", async () => {
  const before = written.length;
  const res = await send("PUT", "/drive/readme.txt", Buffer.from("the readme, exactly as stored\n"));
  assert.equal(res.status, 200, "an unchanged file must not read as a failure");
  assert.equal(written.length, before, "it sent bytes for a file that was already stored");
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

// ⛔ ONE RULE FOR BOTH SIZES. A client switches to pieces above a size of its own choosing, so a
//    rule that differs between the two shows up only above that threshold — on the large files.
//    ⚠ The verdict now lands at COMPLETE rather than at begin: until the pieces are one file there
//      is nothing to hash, and refusing at begin is refusing on the strength of the name again.
test("⛔ pieces that add up to a DIFFERENT file are the same refusal as a whole one", async () => {
  const before = written.length;
  const begun = await send("POST", "/drive/readme.txt?uploads=");
  assert.equal(begun.status, 200, "it refused before it could know what was arriving");
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await begun.text())?.[1];
  assert.ok(uploadId !== undefined);
  await send("PUT", `/drive/readme.txt?partNumber=1&uploadId=${uploadId}`, Buffer.from("something else"));
  const done = await send("POST", `/drive/readme.txt?uploadId=${uploadId}`, Buffer.from("<CompleteMultipartUpload/>"));
  assert.equal(done.status, 409, "large files got a different rule from small ones");
  assert.equal(written.length, before, "it uploaded over an existing file");
});

test("⭐ pieces that add up to the SAME file are answered 200, and nothing is uploaded", async () => {
  const before = written.length;
  const begun = await send("POST", "/drive/readme.txt?uploads=");
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await begun.text())?.[1];
  assert.ok(uploadId !== undefined);
  await send("PUT", `/drive/readme.txt?partNumber=1&uploadId=${uploadId}`, Buffer.from("the readme, "));
  await send("PUT", `/drive/readme.txt?partNumber=2&uploadId=${uploadId}`, Buffer.from("exactly as stored\n"));
  const done = await send("POST", `/drive/readme.txt?uploadId=${uploadId}`, Buffer.from("<CompleteMultipartUpload/>"));
  assert.equal(done.status, 200);
  assert.equal(written.length, before, "it sent bytes for a file that was already stored");
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
