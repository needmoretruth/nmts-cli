// The staging a gateway shares between every drive it builds: whose an upload is, which drive
// finishes it, and what is left on disk when nobody comes back for it.
//
// ⛔ WHY THIS FILE EXISTS. The staging used to be carried from the first drive a bucket was given
//    to every drive built after it, and the store it finished through was that first drive's. With
//    a delegation token that expires, every finish after the first quarter of an hour was refused;
//    with a bucket handed to another user, that user's uploads were stored in the first user's
//    account and their uploads in progress were listed to the second.

import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import type { DecodedBody } from "../src/s3/body.ts";
import type { StoreOutcome, WriteMeta } from "../src/s3/contract.ts";
import { uploadDirName } from "../src/s3/multipart-sweep.ts";
import { createStagingStore, UPLOAD_LIFETIME_MS, type StoreFile } from "../src/s3/staging.ts";

const META: WriteMeta = { storageClass: null, contentType: null };
const STORED: StoreOutcome = { etag: `"${"b".repeat(32)}-1"`, outcome: "stored" };

function piece(text: string): DecodedBody {
  const bytes = Buffer.from(text);
  return { stream: Readable.from([bytes]), size: bytes.length, verified: Promise.resolve() };
}

/** A store that records who stored what. */
function recording(who: string, into: string[]): StoreFile {
  return async (key, path) => {
    into.push(`${who}:${key}:${readFileSync(path, "utf8")}`);
    return STORED;
  };
}

test("⛔ a finish is stored through the drive the bucket has now, not the one the upload began under", async () => {
  const root = mkdtempSync(join(tmpdir(), "nmts-staging-store-"));
  const store = createStagingStore(root);
  const stored: string[] = [];
  // Two drives for one account — the second built after the first one's token ran out.
  const first = store.view("acme", { store: recording("first", stored), owner: async () => "account-a" });
  const id = await first.begin("big.bin", META);
  const tag = await first.part(id, "big.bin", 1, piece("all of it"));
  const second = store.view("acme", { store: recording("second", stored), owner: async () => "account-a" });
  await second.complete(id, "big.bin", [{ partNumber: 1, etag: tag }]);
  assert.deepEqual(stored, ["second:big.bin:all of it"]);
});

test("⛔ a bucket handed to another account has no uploads of the first, and their pieces go", async () => {
  const root = mkdtempSync(join(tmpdir(), "nmts-staging-store-"));
  const store = createStagingStore(root);
  const stored: string[] = [];
  const alice = store.view("acme", { store: recording("alice", stored), owner: async () => "alice" });
  const id = await alice.begin("secret.bin", META);
  const tag = await alice.part(id, "secret.bin", 1, piece("alice's bytes"));
  assert.equal(existsSync(join(root, uploadDirName(id))), true);

  const bob = store.view("acme", { store: recording("bob", stored), owner: async () => "bob" });
  assert.deepEqual(await bob.uploads(), [], "bob was shown alice's upload");
  await assert.rejects(bob.complete(id, "secret.bin", [{ partNumber: 1, etag: tag }]), { code: "NoSuchUpload" });
  await assert.rejects(bob.part(id, "secret.bin", 2, piece("x")), { code: "NoSuchUpload" });
  assert.deepEqual(stored, [], "an upload begun by one account was stored in another's");
  assert.equal(existsSync(join(root, uploadDirName(id))), false, "alice's pieces outlived her access");
  // Nor can alice come back to it: it is gone, not parked.
  await assert.rejects(alice.complete(id, "secret.bin", [{ partNumber: 1, etag: tag }]), { code: "NoSuchUpload" });
});

test("⛔ buckets do not see each other's uploads", async () => {
  const store = createStagingStore(mkdtempSync(join(tmpdir(), "nmts-staging-store-")));
  const stored: string[] = [];
  const one = store.view("one", { store: recording("one", stored) });
  const two = store.view("two", { store: recording("two", stored) });
  const id = await one.begin("k", META);
  assert.deepEqual(await two.uploads(), []);
  await assert.rejects(two.parts(id, "k"), { code: "NoSuchUpload" });
  await one.abort(id, "k");
});

test("⛔ one bucket may keep only so many uploads open, and the one past it is SlowDown", async () => {
  const store = createStagingStore(mkdtempSync(join(tmpdir(), "nmts-staging-store-")), { maxUploadsPerBucket: 2 });
  const view = store.view("acme", { store: recording("x", []) });
  await view.begin("a", META);
  await view.begin("b", META);
  await assert.rejects(view.begin("c", META), (error: unknown) => {
    assert.equal(Reflect.get(Object(error), "status"), 503);
    assert.equal(Reflect.get(Object(error), "retryAfter"), 1);
    return true;
  });
  // Another bucket has its own count.
  await store.view("other", { store: recording("x", []) }).begin("a", META);
});

test("⛔ an abort that arrives while a finish is storing waits for it, and never removes what it reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "nmts-staging-store-"));
  const store = createStagingStore(root);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let read = "";
  const view = store.view("acme", {
    store: async (_key, path) => {
      await held;
      read = readFileSync(path, "utf8");
      return STORED;
    },
  });
  const id = await view.begin("slow.bin", META);
  const tag = await view.part(id, "slow.bin", 1, piece("every byte"));
  const finishing = view.complete(id, "slow.bin", [{ partNumber: 1, etag: tag }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  let aborted = false;
  const abort = view.abort(id, "slow.bin").then(
    () => (aborted = true),
    (error: unknown) => error,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(aborted, false, "the abort did not wait for the finish");
  release();
  assert.equal((await finishing).outcome, "stored");
  assert.equal(read, "every byte", "the finish read a file the abort had removed");
  // The finish worked, so there was nothing left to abort — S3's answer.
  assert.equal(Reflect.get(Object(await abort), "code"), "NoSuchUpload");
});

test("⛔ close waits for a finish that is still storing", async () => {
  const store = createStagingStore(mkdtempSync(join(tmpdir(), "nmts-staging-store-")));
  let done = false;
  const view = store.view("acme", {
    store: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      done = true;
      return STORED;
    },
  });
  const id = await view.begin("k", META);
  const tag = await view.part(id, "k", 1, piece("x"));
  const finishing = view.complete(id, "k", [{ partNumber: 1, etag: tag }]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await store.close();
  assert.equal(done, true, "close returned while a store was still reading its file");
  await finishing;
});

// ⛔ A RESTART FORGETS EVERY UPLOAD; THE DIRECTORY DOES NOT. What the process that crashed left is
//    somebody's plaintext, and only reading the directory itself finds it.
test("⛔ the directory is swept of what this gateway's names made and nobody touched for a day — and only that", async () => {
  const root = mkdtempSync(join(tmpdir(), "nmts-staging-store-"));
  const old = new Date(Date.now() - UPLOAD_LIFETIME_MS - 60_000);
  const abandoned = join(root, uploadDirName("0".repeat(32)));
  mkdirSync(abandoned);
  writeFileSync(join(abandoned, "1-piece"), "left by a crash");
  utimesSync(join(abandoned, "1-piece"), old, old);
  utimesSync(abandoned, old, old);
  const spool = join(root, `nmts-put-${randomUUID()}`);
  writeFileSync(spool, "a body a crash left");
  utimesSync(spool, old, old);
  // Recent: another process sharing the directory is still working on it.
  const inUse = join(root, uploadDirName("1".repeat(32)));
  mkdirSync(inUse);
  writeFileSync(join(inUse, "1-piece"), "arriving now");
  // Not this gateway's name at all.
  const theirs = join(root, "somebody-elses");
  writeFileSync(theirs, "not ours");
  utimesSync(theirs, old, old);

  const store = createStagingStore(root, { sweepEveryMs: 60 * 60 * 1000 });
  await store.sweep();
  assert.equal(existsSync(abandoned), false, "a day-old upload directory was left");
  assert.equal(existsSync(spool), false, "a day-old spooled body was left");
  assert.equal(existsSync(inUse), true, "a directory in use by another process was removed");
  assert.equal(existsSync(theirs), true, "a file this gateway did not make was removed");
  await store.close();
});
