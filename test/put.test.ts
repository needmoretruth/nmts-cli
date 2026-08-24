// The decisions `put` makes before it spends anything.
//
// ⛔ THE PRICE AND THE DESTINATION ARE DECIDED WITHOUT A NETWORK, and that is what makes them
//    testable. Everything below runs against entries in memory.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { folderIdFor } from "../src/commands/put.ts";
import { creditsFor } from "../src/upload-price.ts";
import { namesIn } from "../src/drive-paths.ts";
import { uniqueFileName } from "../src/shared/lib/drive/unique-name.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";

function folder(id: string, name: string, parentId: string | null = null): ManifestEntry {
  return { id, parentId, kind: 0, name, size: 0, createdAt: 1, updatedAt: 1 };
}
function file(id: string, name: string, parentId: string | null = null): ManifestEntry {
  return { id, parentId, kind: 1, name, size: 10, createdAt: 1, updatedAt: 1 };
}

test("the price is one credit per started mebibyte", () => {
  assert.equal(creditsFor(1), 1, "a one-byte file still occupies a whole unit");
  assert.equal(creditsFor(1024 * 1024), 1);
  assert.equal(creditsFor(1024 * 1024 + 1), 2, "the next byte starts the next unit");
  assert.equal(creditsFor(10 * 1024 * 1024), 10);
});

test("no destination means the top of the drive, however it is spelled", () => {
  const entries = [folder("f1", "photos")];
  for (const spelling of [undefined, "", "/", "."]) {
    assert.equal(folderIdFor(spelling, entries), null);
  }
});

test("a destination is matched by its whole path, not by its last name", () => {
  const entries = [
    folder("f1", "photos"),
    folder("f2", "2026", "f1"),
    folder("f3", "2026"), // a different folder with the same last name, at the root
  ];
  assert.equal(folderIdFor("photos/2026", entries), "f2");
  assert.equal(folderIdFor("2026", entries), "f3");
  assert.equal(folderIdFor("/photos/2026/", entries), "f2", "leading and trailing slashes are the same path");
});

test("⛔ a destination that does not exist stops the upload rather than defaulting to the root", () => {
  // Silently uploading to the root would put the file somewhere the caller did not ask for, and
  // an agent would have no way to notice -- the upload SUCCEEDED, just not where it said.
  assert.throws(() => folderIdFor("nope", [folder("f1", "photos")]), /No folder at "nope"/);
});

test("a file is not a folder, even with the right path", () => {
  assert.throws(() => folderIdFor("notes.txt", [file("i1", "notes.txt")]), /No folder/);
});

test("a folder in the trash is not a destination", () => {
  const trashed: ManifestEntry = { ...folder("f1", "old"), deletedAt: 99 };
  assert.throws(() => folderIdFor("old", [trashed]), /No folder/);
});

test("two folders with one path stop the upload instead of picking one", () => {
  const entries = [folder("f1", "same"), folder("f2", "same")];
  assert.throws(() => folderIdFor("same", entries), /names 2 folders/);
});

test("the taken names are the ones in THAT folder, not the whole drive", () => {
  const entries = [file("i1", "notes.txt", null), file("i2", "other.txt", "f1")];
  assert.deepEqual([...namesIn(entries, null)], ["notes.txt"]);
  assert.deepEqual([...namesIn(entries, "f1")], ["other.txt"]);
});

test("⛔ a name in the trash still counts as taken", () => {
  // Restoring it must not land on top of a live file that took its name while it was away.
  const trashed: ManifestEntry = { ...file("i1", "notes.txt"), deletedAt: 5 };
  assert.deepEqual([...namesIn([trashed], null)], ["notes.txt"]);
});

test("a colliding name is numbered rather than replacing what is there", () => {
  // NMTS keeps no previous versions of a file, so replacing one would be permanent loss.
  const taken = new Set(["report.pdf"]);
  assert.equal(uniqueFileName("report.pdf", taken), "report (2).pdf");
  assert.equal(uniqueFileName("fresh.pdf", taken), "fresh.pdf");
});
