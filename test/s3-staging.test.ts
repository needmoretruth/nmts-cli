// Multipart staging: the pieces, and what becomes of them.
//
// ⛔ THE REAL STAGING, ON A REAL DIRECTORY. What goes wrong in this code is ordering and integrity,
//    and a stub that keeps pieces in a map has neither problem — it would test the protocol above
//    it and nothing here. The one thing stubbed is the store at the end, because that is the step
//    that spends money.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { createStaging } from "../src/s3/staging.ts";

const ROOT = mkdtempSync(join(tmpdir(), "nmts-staging-test-"));
after(() => {
  // Best effort: the test's own directory, nothing else.
  if (existsSync(ROOT)) readdirSync(ROOT);
});

const stored: Array<{ key: string; bytes: string }> = [];
const staging = createStaging(ROOT, async (key, path) => {
  stored.push({ key, bytes: readFileSync(path, "utf8") });
});

function piece(text: string): { body: Readable; size: number; sha256: string } {
  const bytes = Buffer.from(text);
  return {
    body: Readable.from([bytes]),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

// ⛔ MEASURED FROM A REAL CLIENT: rclone sent parts 1, 3 and 2 in that order, concurrently. A
//    staging that appends as pieces arrive assembles that file wrong and nothing complains.
test("pieces that arrive out of order still make the file in order", async () => {
  const upload = await staging.begin("notes/big.txt");
  const three = piece("THREE");
  const one = piece("ONE-");
  const two = piece("TWO-");
  await staging.part(upload, 3, three.body, three.size, three.sha256);
  await staging.part(upload, 1, one.body, one.size, one.sha256);
  await staging.part(upload, 2, two.body, two.size, two.sha256);
  const etag = await staging.complete(upload);
  assert.deepEqual(stored.at(-1), { key: "notes/big.txt", bytes: "ONE-TWO-THREE" });
  assert.match(etag, /-3"$/, "the tag should say how many pieces it was made of");
});

test("⛔ a piece whose bytes are not what was declared is refused and not kept", async () => {
  const upload = await staging.begin("x.bin");
  const good = piece("the bytes that were signed for");
  const before = stored.length;
  await assert.rejects(
    staging.part(upload, 1, Readable.from([Buffer.from("something else entirely")]), good.size, good.sha256),
    /do not hash/,
  );
  await assert.rejects(staging.complete(upload), /no parts/);
  assert.equal(stored.length, before, "something was stored from a bad part");
});

test("⛔ a piece that is shorter than it said is refused", async () => {
  const upload = await staging.begin("y.bin");
  await assert.rejects(staging.part(upload, 1, Readable.from([Buffer.from("short")]), 999, null), /999/);
  await staging.abort(upload);
});

test("aborting leaves nothing behind", async () => {
  const upload = await staging.begin("z.bin");
  const one = piece("some bytes");
  await staging.part(upload, 1, one.body, one.size, one.sha256);
  assert.equal(existsSync(join(ROOT, upload)), true);
  await staging.abort(upload);
  assert.equal(existsSync(join(ROOT, upload)), false);
  await assert.rejects(staging.complete(upload), /No upload/);
});

test("⛔ an id nobody began is not an upload", async () => {
  await assert.rejects(staging.complete(randomUUID()), /No upload/);
  const one = piece("x");
  await assert.rejects(staging.part(randomUUID(), 1, one.body, one.size, null), /No upload/);
});

test("finishing clears the pieces, so a run does not accumulate somebody's plaintext", async () => {
  const upload = await staging.begin("w.bin");
  const one = piece("kept only until it is one file");
  await staging.part(upload, 1, one.body, one.size, one.sha256);
  await staging.complete(upload);
  assert.equal(existsSync(join(ROOT, upload)), false);
});
