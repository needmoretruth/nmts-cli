// Multipart staging: the pieces, and what becomes of them.
//
// ⛔ THE REAL STAGING, ON A REAL DIRECTORY. What goes wrong in this code is ordering and integrity,
//    and a stub that keeps pieces in a map has neither problem — it would test the protocol above
//    it and nothing here. The one thing stubbed is the store at the end, because that is the step
//    that spends money.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { BodyRefusal, type DecodedBody } from "../src/s3/body.ts";
import type { StoreOutcome, WriteMeta } from "../src/s3/contract.ts";
import { uploadDirName } from "../src/s3/multipart-sweep.ts";
import { createStaging, UPLOAD_LIFETIME_MS, type PartChoice } from "../src/s3/staging.ts";

const ROOT = mkdtempSync(join(tmpdir(), "nmts-staging-test-"));
const dirOf = (id: string): string => join(ROOT, uploadDirName(id));
const META: WriteMeta = { storageClass: null, contentType: null };

const stored: Array<{ key: string; bytes: string; meta: WriteMeta }> = [];
let failNext: Error | null = null;
let clock = 1_700_000_000_000;
const staging = createStaging(
  ROOT,
  async (key, path, meta): Promise<StoreOutcome> => {
    if (failNext !== null) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    stored.push({ key, bytes: readFileSync(path, "utf8"), meta });
    return { etag: `"${"a".repeat(32)}-1"`, outcome: "stored" };
  },
  () => clock,
);

function piece(text: string, verified: Promise<void> = Promise.resolve()): DecodedBody {
  const bytes = Buffer.from(text);
  return { stream: Readable.from([bytes]), size: bytes.length, verified };
}

const md5 = (text: string): string => `"${createHash("md5").update(text).digest("hex")}"`;

async function stage(key: string, pieces: ReadonlyArray<[number, string]>): Promise<{ id: string; list: PartChoice[] }> {
  const id = await staging.begin(key, META);
  const list: PartChoice[] = [];
  for (const [n, text] of pieces) list.push({ partNumber: n, etag: await staging.part(id, key, n, piece(text)) });
  return { id, list: list.sort((a, b) => a.partNumber - b.partNumber) };
}

// ⛔ MEASURED FROM A REAL CLIENT: rclone sent parts 1, 3 and 2 in that order, concurrently. A
//    staging that appends as pieces arrive assembles that file wrong and nothing complains.
test("pieces that arrive out of order still make the file in order", async () => {
  const { id, list } = await stage("notes/big.txt", [
    [3, "THREE"],
    [1, "ONE-"],
    [2, "TWO-"],
  ]);
  const outcome = await staging.complete(id, "notes/big.txt", list);
  assert.deepEqual(stored.at(-1), { key: "notes/big.txt", bytes: "ONE-TWO-THREE", meta: META });
  assert.equal(outcome.etag, `"${"a".repeat(32)}-1"`, "the tag is the store's, not one made up here");
});

test("a piece's tag is the MD5 of its bytes, which is what S3 answers", async () => {
  const id = await staging.begin("tag.bin", META);
  assert.equal(await staging.part(id, "tag.bin", 1, piece("hello")), md5("hello"));
  await staging.abort(id, "tag.bin");
});

test("only the listed pieces make the file, and a piece sent twice is its last version", async () => {
  const id = await staging.begin("chosen.bin", META);
  await staging.part(id, "chosen.bin", 1, piece("first-"));
  await staging.part(id, "chosen.bin", 1, piece("again-"));
  const two = await staging.part(id, "chosen.bin", 2, piece("two"));
  await staging.part(id, "chosen.bin", 3, piece("left out"));
  await staging.complete(id, "chosen.bin", [
    { partNumber: 1, etag: md5("again-") },
    { partNumber: 2, etag: two.replace(/"/g, "") },
  ]);
  assert.equal(stored.at(-1)?.bytes, "again-two");
});

test("⛔ a listed tag that is not what was staged is InvalidPart, and a list out of order is InvalidPartOrder", async () => {
  const { id, list } = await stage("wrong.bin", [
    [1, "a"],
    [2, "b"],
  ]);
  const [one, two] = list;
  assert.ok(one !== undefined && two !== undefined);
  await assert.rejects(staging.complete(id, "wrong.bin", [one, { partNumber: 2, etag: md5("c") }]), { code: "InvalidPart" });
  await assert.rejects(staging.complete(id, "wrong.bin", [one, { partNumber: 3, etag: two.etag }]), { code: "InvalidPart" });
  await assert.rejects(staging.complete(id, "wrong.bin", [two, one]), { code: "InvalidPartOrder" });
  await assert.rejects(staging.complete(id, "wrong.bin", [one, one]), { code: "InvalidPartOrder" });
  // None of that cost the pieces.
  await staging.complete(id, "wrong.bin", list);
  assert.equal(stored.at(-1)?.bytes, "ab");
});

test("⛔ a piece whose body failed its rules is refused and not kept", async () => {
  const id = await staging.begin("x.bin", META);
  const before = stored.length;
  const refused = Promise.reject(new BodyRefusal(400, "BadDigest", "not what was declared"));
  await assert.rejects(staging.part(id, "x.bin", 1, piece("changed on the way", refused)), { code: "BadDigest" });
  assert.deepEqual(await staging.parts(id, "x.bin"), []);
  assert.equal(stored.length, before, "something was stored from a bad part");
  await staging.abort(id, "x.bin");
});

test("⛔ a piece that is shorter than it said is refused", async () => {
  const id = await staging.begin("y.bin", META);
  const short = { stream: Readable.from([Buffer.from("short")]), size: 999, verified: Promise.resolve() };
  await assert.rejects(staging.part(id, "y.bin", 1, short), { code: "IncompleteBody" });
  await staging.abort(id, "y.bin");
});

test("⛔ a finish that fails keeps every piece, so the same finish can be sent again", async () => {
  const { id, list } = await stage("retry.bin", [[1, "kept"]]);
  failNext = new Error("the network dropped");
  await assert.rejects(staging.complete(id, "retry.bin", list), /network dropped/);
  assert.equal(existsSync(dirOf(id)), true, "the pieces went with the failure");
  assert.equal((await staging.parts(id, "retry.bin")).length, 1);
  await staging.complete(id, "retry.bin", list);
  assert.equal(stored.at(-1)?.bytes, "kept");
  // Sent once more after it worked — a response that was lost — it is answered the same.
  assert.equal((await staging.complete(id, "retry.bin", list)).outcome, "stored");
});

test("⛔ an upload answers only to the key it began with", async () => {
  const { id, list } = await stage("mine.bin", [[1, "m"]]);
  await assert.rejects(staging.part(id, "other.bin", 2, piece("o")), { code: "NoSuchUpload" });
  await assert.rejects(staging.complete(id, "other.bin", list), { code: "InvalidRequest" });
  await assert.rejects(staging.parts(id, "other.bin"), { code: "NoSuchUpload" });
  await staging.abort(id, "mine.bin");
});

test("aborting leaves nothing behind", async () => {
  const { id } = await stage("z.bin", [[1, "some bytes"]]);
  assert.equal(existsSync(dirOf(id)), true);
  await staging.abort(id, "z.bin");
  assert.equal(existsSync(dirOf(id)), false);
  await assert.rejects(staging.complete(id, "z.bin", [{ partNumber: 1, etag: md5("some bytes") }]), {
    code: "NoSuchUpload",
  });
});

test("⛔ an id nobody began is not an upload", async () => {
  await assert.rejects(staging.complete(randomUUID(), "k", [{ partNumber: 1, etag: md5("x") }]), { code: "NoSuchUpload" });
  await assert.rejects(staging.part(randomUUID(), "k", 1, piece("x")), { code: "NoSuchUpload" });
  await assert.rejects(staging.abort(randomUUID(), "k"), { code: "NoSuchUpload" });
});

test("finishing clears the pieces, so a run does not accumulate somebody's plaintext", async () => {
  const { id, list } = await stage("w.bin", [[1, "kept only until it is one file"]]);
  await staging.complete(id, "w.bin", list);
  assert.equal(existsSync(dirOf(id)), false);
  assert.equal(
    (await staging.uploads()).some((u) => u.uploadId === id),
    false,
  );
});

test("the uploads in progress and their pieces can be listed", async () => {
  const { id } = await stage("listed/a.bin", [
    [2, "bb"],
    [1, "a"],
  ]);
  const parts = await staging.parts(id, "listed/a.bin");
  assert.deepEqual(
    parts.map((p) => [p.partNumber, p.size, p.etag]),
    [
      [1, 1, md5("a")],
      [2, 2, md5("bb")],
    ],
  );
  assert.ok((await staging.uploads()).some((u) => u.uploadId === id && u.key === "listed/a.bin"));
  await staging.abort(id, "listed/a.bin");
});

test("⛔ an upload nobody has touched for more than a day is removed when the next one begins", async () => {
  const { id } = await stage("stale.bin", [[1, "old"]]);
  clock += UPLOAD_LIFETIME_MS + 1;
  const fresh = await staging.begin("fresh.bin", META);
  assert.equal(existsSync(dirOf(id)), false, "a day-old upload's plaintext was left on disk");
  assert.equal(
    (await staging.uploads()).some((u) => u.uploadId === id),
    false,
  );
  assert.ok((await staging.uploads()).some((u) => u.uploadId === fresh));
  await staging.abort(fresh, "fresh.bin");
});

// ⛔ COUNTED FROM THE LAST PIECE, NOT FROM THE BEGINNING: a large file sent slowly over more than a
//    day is still arriving, and taking its pieces away would make it impossible to finish.
test("⛔ an upload still receiving pieces is kept past a day from when it began", async () => {
  const id = await staging.begin("slow.bin", META);
  const first = await staging.part(id, "slow.bin", 1, piece("day one-"));
  clock += UPLOAD_LIFETIME_MS - 1000;
  const second = await staging.part(id, "slow.bin", 2, piece("day two"));
  clock += 2000;
  await staging.abort(await staging.begin("sweeps.bin", META), "sweeps.bin");
  await staging.complete(id, "slow.bin", [
    { partNumber: 1, etag: first },
    { partNumber: 2, etag: second },
  ]);
  assert.equal(stored.at(-1)?.bytes, "day one-day two");
});
