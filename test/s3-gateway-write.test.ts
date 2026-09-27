// The local S3 gateway writing to a drive, driven over real HTTP by a signed client.
//
// ⛔ A SECOND GATEWAY, because read-only is not a mode this one can be put into: it is the ABSENCE
//    of a writer, which is what a machine with no spending agreement produces. Testing both from
//    one instance would mean inventing a switch that the product does not have. So the read-only
//    one is started here too, and the refusals are asked of it.
//
// ⛔ REAL SOCKETS, NOT A CALLED HANDLER, for the reason `s3-gateway.test.ts` gives: the parsing
//    between a request line and a signature is where a gateway goes wrong.
//
// ⛔ THE WRITER IS THE REAL ONE (`createDriveSource`) over a fake account, with the default
//    overwrite rule — `refuse`, which is what `nmts s3` runs. Replacing is `s3-gateway-overwrite`.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { EMPTY_ETAG } from "../src/s3/listing.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, raw, readOnly, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const refusing = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "drive" ? readOnly : null),
  bucketNames: () => ["drive"],
});
const HOST = await listening(refusing);
after(() => refusing.close());

const drive = await fakeDrive();
await drive.seed("readme.txt", "the readme, exactly as stored\n");
const source = drive.source();
const writable = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "drive" ? source : null),
  bucketNames: () => ["drive"],
});
const WRITE_HOST = await listening(writable);
after(() => writable.close());

const put = (target: string, text: string, headers: Record<string, string> = {}): Promise<Response> =>
  send(WRITE_HOST, "PUT", target, { body: Buffer.from(text), headers });

async function begin(key: string, headers: Record<string, string> = {}): Promise<string> {
  const begun = await send(WRITE_HOST, "POST", `/drive/${key}?uploads=`, { headers });
  assert.equal(begun.status, 200);
  const uploadId = values(await begun.text(), "UploadId")[0];
  assert.ok(uploadId !== undefined && uploadId !== "", "no upload id came back");
  return uploadId;
}

/** Stage the pieces, then finish with the list of what came back — the way every client does. */
async function upload(key: string, pieces: ReadonlyArray<[number, string]>): Promise<Response> {
  const uploadId = await begin(key);
  const tags = new Map<number, string>();
  for (const [n, text] of pieces) {
    const res = await put(`/drive/${key}?partNumber=${n}&uploadId=${uploadId}&x-id=UploadPart`, text);
    assert.equal(res.status, 200);
    tags.set(n, res.headers.get("etag") ?? "");
  }
  const list = [...tags.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, etag]) => `<Part><PartNumber>${n}</PartNumber><ETag>${etag}</ETag></Part>`)
    .join("");
  return await send(WRITE_HOST, "POST", `/drive/${key}?uploadId=${uploadId}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
  });
}

// ⛔ MEASURED FROM A REAL CLIENT: rclone's first act when copying a file is to create the bucket.
//    Refusing it ends the copy before the upload is attempted.
test("making the bucket that is already there succeeds", async () => {
  assert.equal((await send(WRITE_HOST, "PUT", "/drive")).status, 200);
});

test("a file arrives whole, at the key the client used, and its tag is what HEAD answers", async () => {
  const res = await put("/drive/notes/new.txt?x-id=PutObject", "hello from a sync tool\n");
  assert.equal(res.status, 200);
  assert.equal(drive.textAt("notes/new.txt"), "hello from a sync tool\n");
  const etag = res.headers.get("etag");
  assert.match(etag ?? "", /^"[0-9a-f]{32}-1"$/);
  const head = await send(WRITE_HOST, "HEAD", "/drive/notes/new.txt");
  assert.equal(head.headers.get("etag"), etag, "PUT and HEAD answered different tags");
  const listed = await (await send(WRITE_HOST, "GET", "/drive?list-type=2&prefix=notes%2F")).text();
  // The folder's own marker, `notes/`, lists first with the empty object's tag.
  assert.deepEqual(values(listed, "Key"), ["notes/", "notes/new.txt"]);
  assert.deepEqual(values(listed, "ETag"), [EMPTY_ETAG, etag], "the listing answered a different tag");
});

// ⛔ THE ONE THAT KEEPS A SYNC TOOL FROM DUPLICATING FOREVER. This drive does not replace files,
//    so DIFFERENT content at a taken key is declined — and declined with 409, because the request
//    was well formed and the drive said no. A 500 would have the client retry it forever.
test("⛔ a key that already holds a DIFFERENT file is a conflict, and nothing is written", async () => {
  const before = drive.stores.length;
  const res = await put("/drive/readme.txt", "replacement");
  assert.equal(res.status, 409);
  const body = await res.text();
  assert.match(body, /<Code>InvalidRequest<\/Code>/);
  assert.match(body, /does not replace files/);
  assert.equal(drive.stores.length, before, "it uploaded over an existing file");
  assert.equal(drive.textAt("readme.txt"), "the readme, exactly as stored\n");
});

// ⭐ THE SAME BYTES AT THE SAME KEY IS NOT A FAILURE, it is a file that is already there. A backup
//    program sends the same names every night, and answering 409 made every one of those nights a
//    page of errors.
test("⭐ the SAME file at a taken key is answered 200 with its tag, and nothing is uploaded", async () => {
  const before = drive.stores.length;
  const head = await send(WRITE_HOST, "HEAD", "/drive/readme.txt");
  const res = await put("/drive/readme.txt", "the readme, exactly as stored\n");
  assert.equal(res.status, 200, "an unchanged file must not read as a failure");
  assert.equal(res.headers.get("etag"), head.headers.get("etag"));
  assert.equal(drive.stores.length, before, "it sent bytes for a file that was already stored");
});

test("what the client said about the file reaches the store: storage class and type", async () => {
  await put("/drive/meta.txt", "x", { "x-amz-storage-class": " standard_ia ", "content-type": "text/plain" });
  assert.deepEqual(drive.stores.at(-1)?.meta, { storageClass: "STANDARD_IA", contentType: "text/plain" });
  await put("/drive/bare.txt", "y");
  assert.deepEqual(drive.stores.at(-1)?.meta, { storageClass: null, contentType: null });
});

test("deleting puts the file in the trash, and deleting nothing is still fine", async () => {
  await drive.seed("doomed.txt", "bye");
  assert.equal((await send(WRITE_HOST, "DELETE", "/drive/doomed.txt")).status, 204);
  assert.equal(drive.trashed.at(-1), "/doomed.txt");
  const again = await send(WRITE_HOST, "DELETE", "/drive/doomed.txt");
  assert.equal(again.status, 204, "a second delete of the same key must not fail a sync");
});

// ⛔ WITHOUT THE SPENDING AGREEMENT EVERY WRITE IS REFUSED, and the refusal names the one command
//    that changes it. A gateway cannot ask: its caller is a program.
test("⛔ with no writer, writes are refused and say why", async () => {
  const res = await send(HOST, "PUT", "/drive/new.txt", { body: Buffer.from("x") });
  assert.equal(res.status, 501);
  const body = await res.text();
  assert.match(body, /read only/i);
  assert.match(body, /consent grant spend/);
  assert.equal((await send(HOST, "DELETE", "/drive/readme.txt")).status, 501);
  assert.equal((await send(HOST, "PUT", "/drive/c.txt", { headers: { "x-amz-copy-source": "drive/readme.txt" } })).status, 501);
});

// ⛔ MEASURED FROM A REAL CLIENT, AND THE ORDER IS THE POINT: rclone sent parts 1, 3, 2.
test("a file that arrives in pieces is stored whole, in order, and answers the tag HEAD does", async () => {
  const done = await upload("big.bin", [
    [1, "ONE-"],
    [3, "THREE"],
    [2, "TWO-"],
  ]);
  assert.equal(done.status, 200);
  const body = await done.text();
  assert.deepEqual(values(body, "Key"), ["big.bin"]);
  assert.equal(drive.textAt("big.bin"), "ONE-TWO-THREE");
  const head = await send(WRITE_HOST, "HEAD", "/drive/big.bin");
  assert.deepEqual(values(body, "ETag"), [head.headers.get("etag") ?? ""]);
});

test("what the client said when it began reaches the store when it finishes", async () => {
  const uploadId = await begin("pieces-meta.bin", { "x-amz-storage-class": "glacier", "content-type": "image/png" });
  const part = await put(`/drive/pieces-meta.bin?partNumber=1&uploadId=${uploadId}`, "abc");
  const list = `<Part><PartNumber>1</PartNumber><ETag>${part.headers.get("etag") ?? ""}</ETag></Part>`;
  const done = await send(WRITE_HOST, "POST", `/drive/pieces-meta.bin?uploadId=${uploadId}`, {
    body: Buffer.from(`<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`),
  });
  assert.equal(done.status, 200);
  await done.text();
  assert.deepEqual(drive.stores.at(-1)?.meta, { storageClass: "GLACIER", contentType: "image/png" });
});

// ⛔ ONE RULE FOR BOTH SIZES. A client switches to pieces above a size of its own choosing, so a
//    rule that differs between the two shows up only above that threshold — on the large files.
//    ⚠ The finish's refusal carries the same code as the whole upload's, inside a 200: only the
//      joined bytes can decide it, and by then the finish has begun answering (`long-answer.ts`).
test("⛔ pieces that add up to a DIFFERENT file are the same refusal as a whole one", async () => {
  const before = drive.stores.length;
  const whole = await put("/drive/readme.txt", "something else");
  assert.equal(whole.status, 409);
  const done = await upload("readme.txt", [[1, "something else"]]);
  // Refused inside the first keep-alive interval, so with the same status too (`long-answer.ts`).
  assert.equal(done.status, 409);
  const codes = values(await done.text(), "Code");
  assert.deepEqual(codes, values(await whole.text(), "Code"), "large files got a different rule from small ones");
  assert.deepEqual(codes, ["InvalidRequest"]);
  assert.equal(drive.stores.length, before, "it uploaded over an existing file");
});

test("⭐ pieces that add up to the SAME file are answered 200, and nothing is uploaded", async () => {
  const before = drive.stores.length;
  const done = await upload("readme.txt", [
    [1, "the readme, "],
    [2, "exactly as stored\n"],
  ]);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /<CompleteMultipartUploadResult /);
  assert.equal(drive.stores.length, before, "it sent bytes for a file that was already stored");
});

test("⛔ with no writer, a piecewise upload is refused too", async () => {
  const res = await send(HOST, "POST", "/drive/big2.bin?uploads=");
  assert.equal(res.status, 501);
  assert.match(await res.text(), /consent grant spend/);
});

test("aborting a piecewise upload answers 204", async () => {
  const uploadId = await begin("gone.bin");
  const res = await send(WRITE_HOST, "DELETE", `/drive/gone.bin?uploadId=${uploadId}`);
  assert.equal(res.status, 204);
});

// ⛔ THE BODY'S OWN RULES DECIDE BEFORE ANYTHING IS STORED. The signature covers the digest the
//    client declared, not the bytes; bytes that do not hash to it are refused as the body decoder
//    says, and never become somebody's file.
test("⛔ a body that does not hash to what was signed is refused, and nothing is stored", async () => {
  const before = drive.stores.length;
  const signed = sign("PUT", "/drive/tampered.txt", WRITE_HOST, CREDENTIAL, new Date(), Buffer.from("what was signed"));
  const res = await raw(
    WRITE_HOST,
    "PUT",
    "/drive/tampered.txt",
    { ...signed.headers, "content-length": "15" },
    Buffer.from("what was sent!!"),
  );
  assert.ok(res.status >= 400 && res.status < 500, `answered ${res.status}`);
  assert.doesNotMatch(res.body, /InternalError/);
  assert.equal(drive.stores.length, before, "a body that failed its digest was stored");
  assert.equal(drive.textAt("tampered.txt"), undefined);
});

test("⛔ an upload with no length is refused as S3 refuses it, not stored as an empty file", async () => {
  const signed = sign("PUT", "/drive/lengthless.txt", WRITE_HOST, CREDENTIAL, new Date(), Buffer.alloc(0));
  const res = await raw(WRITE_HOST, "PUT", "/drive/lengthless.txt", {
    ...signed.headers,
    "transfer-encoding": "chunked",
  });
  assert.equal(res.status, 411);
  assert.match(res.body, /<Code>MissingContentLength<\/Code>/);
  assert.equal(drive.textAt("lengthless.txt"), undefined);
});
