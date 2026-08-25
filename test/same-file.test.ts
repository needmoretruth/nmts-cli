// What this file pins: **the rule that asks whether the file arriving at a key is the file already
// there — by content, not by name.**
//
// ⛔ WHY THE RULE CHANGED (owner directive 2026-08-25). The gateway used to decline a taken key on
//    the strength of the NAME. A backup program's whole job is to send the same names every night,
//    so every run failed on every file already stored — and a sync tool records a 409 as a failure,
//    which is the wrong word for "it is already there".
//
// ⛔ THE HASH IS SEALED, AND THIS TEST SEALS IT THE WAY THE PRODUCT DOES rather than restating what
//    the reader expects. A test that built the ciphertext from the reader's own assumptions would
//    only prove the reader agrees with itself. What is sealed here goes from the account code
//    through the real engine, with the domain separator the format registry names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import {
  compare,
  hashOfFile,
  isKeyConflict,
  recordedHash,
  refusalFor,
  verdictForKey,
} from "../src/s3/same-file.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode } from "./helpers.ts";

const DIR = mkdtempSync(join(tmpdir(), "nmts-same-file-"));

/** Seal a content hash the way an upload does, so the reader is tested against the format. */
async function sealHash(code: string, hash: Uint8Array): Promise<string> {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const dataKey = derived.slice(from, to);
  derived.fill(0);
  const out = crypt.b64_encode(crypt.envelope_seal(dataKey, new TextEncoder().encode(AAD.contentHash), hash));
  dataKey.fill(0);
  return out;
}

function fileHolding(name: string, text: string): string {
  const path = join(DIR, name);
  writeFileSync(path, text);
  return path;
}

test("the same bytes are the same file, and one byte apart is not", async () => {
  const a = await hashOfFile(fileHolding("a", "the readme, exactly as stored\n"));
  const same = await hashOfFile(fileHolding("b", "the readme, exactly as stored\n"));
  const differs = await hashOfFile(fileHolding("c", "the readme, exactly as stored"));
  assert.equal(compare(a, same), "same");
  assert.equal(compare(a, differs), "differs", "one missing character at the end read as identical");
});

test("nothing there and no recorded hash are different answers", async () => {
  const h = await hashOfFile(fileHolding("d", "x"));
  assert.equal(compare(undefined, h), "free");
  // Drawing "cannot tell" as "nothing there" is how a file gets written over.
  assert.equal(compare(null, h), "unknown");
});

test("⭐ the sealed hash opens with this account's key and is compared against a real file", async () => {
  const code = await generateCode();
  const path = fileHolding("e", "hello from a sync tool\n");
  const hash = await hashOfFile(path);
  const opened = await recordedHash(code, await sealHash(code, hash));
  assert.ok(opened);
  assert.equal(compare(opened, hash), "same");
  assert.equal(compare(opened, await hashOfFile(fileHolding("f", "hello from a sync tool"))), "differs");
});

test("⛔ a hash sealed by another account is an error, not an absence", async () => {
  const mine = await generateCode();
  const theirs = await generateCode();
  const sealed = await sealHash(theirs, await hashOfFile(fileHolding("g", "x")));
  // Folding "it will not open" into "there is no hash" would let an altered file list through as
  // an upload, quietly.
  await assert.rejects(() => recordedHash(mine, sealed), /did not open with this account's key/);
});

test("no recorded hash is a normal state and is null — files stored before it existed", async () => {
  const code = await generateCode();
  assert.equal(await recordedHash(code, undefined), null);
  assert.equal(await recordedHash(code, ""), null);
});

test("the refusal tells the two cases apart, and the gateway recognises both", () => {
  const differs = refusalFor("differs", "photos/jeju.jpg");
  const unknown = refusalFor("unknown", "photos/jeju.jpg");
  assert.match(differs.message, /A different file is already at photos\/jeju\.jpg/);
  assert.match(unknown.message, /no recorded hash/);
  assert.notEqual(differs.message, unknown.message, "one sentence for two cases tells the reader nothing");
  assert.ok(isKeyConflict(differs) && isKeyConflict(unknown));
  assert.equal(isKeyConflict(new Error("something else")), false);
});

// ── Finding the key in the file list (⭐ this is the function the command actually calls) ─────────
//
// ⛔ The tests above pin "are these hashes equal". This one pins "does it find the right file",
//    which is a different failure: a perfect comparison against the WRONG entry passes silently and
//    lets an upload through.
const NOW = 1_700_000_000_000;
const folderRow = (id: string, name: string, parentId: string | null): ManifestEntry => ({
  id, kind: 0, name, parentId, createdAt: NOW, updatedAt: NOW, size: 0,
});
const fileRow = (id: string, name: string, parentId: string | null, size: number, hashCt?: string): ManifestEntry => ({
  id, kind: 1, name, parentId, createdAt: NOW, updatedAt: NOW, size,
  dekWrapped: "not-opened-in-this-test",
  ...(hashCt === undefined ? {} : { contentHashCt: hashCt }),
});

test("⭐ it finds that key in the file list and compares against THAT file's hash", async () => {
  const code = await generateCode();
  const path = fileHolding("h", "the readme, exactly as stored\n");
  const other = fileHolding("i", "something else entirely\n");
  const entries: ManifestEntry[] = [
    folderRow("f1", "photos", null),
    fileRow("i1", "readme.txt", null, 30, await sealHash(code, await hashOfFile(path))),
    fileRow("i2", "jeju.jpg", "f1", 99, await sealHash(code, await hashOfFile(other))),
  ];

  assert.equal(await verdictForKey(entries, "readme.txt", code, path), "same");
  assert.equal(await verdictForKey(entries, "readme.txt", code, other), "differs");
  assert.equal(await verdictForKey(entries, "notes/new.txt", code, path), "free", "an empty key read as taken");
  // A file inside a folder is only reachable at the key that carries the folder. Matching on the
  // name alone would compare an upload against somebody else's file.
  assert.equal(await verdictForKey(entries, "jeju.jpg", code, other), "free", "it matched a name and ignored the folder");
  assert.equal(await verdictForKey(entries, "photos/jeju.jpg", code, other), "same");
});

test("a file in the trash does not hold its key", async () => {
  const code = await generateCode();
  const path = fileHolding("j", "gone\n");
  const entries: ManifestEntry[] = [
    { ...fileRow("i9", "gone.txt", null, 5, await sealHash(code, await hashOfFile(path))), deletedAt: NOW },
  ];
  assert.equal(await verdictForKey(entries, "gone.txt", code, path), "free");
});

test("⛔ an older file with no recorded hash is 'unknown', never 'same'", async () => {
  const code = await generateCode();
  const path = fileHolding("k", "x\n");
  const entries: ManifestEntry[] = [fileRow("i8", "old.txt", null, 2)];
  assert.equal(await verdictForKey(entries, "old.txt", code, path), "unknown");
});
