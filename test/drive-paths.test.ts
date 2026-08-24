// A path inside the account is not a path on this disk, and the difference is not academic.
//
// ⛔ THE TEST THAT MATTERS IS THE LAST ONE, and it is written the way it is because the bug it
//    holds is invisible on the machine that runs it. Fetching a folder failed outright on Windows
//    — every stored name came back through `path.relative`, which answers in the MACHINE's
//    separator, so `deep/under.txt` became `deep\under.txt` and the containment check downstream
//    refused it as a name trying to climb out. On Linux and macOS the two separators are the same
//    character, so every test passed and the whole class was invisible until a continuous-
//    integration run on Windows said so.
//
//    ⚠ AND SAY WHAT THAT COSTS: this file CANNOT reproduce the Windows failure. Substituting
//    `path.relative` back in turns one test here red — the one about a path that is not under the
//    prefix, because that answer differs on every platform — and leaves the separator assertion
//    green, because on this machine the two characters are the same. Measured, not assumed. So the
//    last test asks `node:path` for the WINDOWS answer explicitly and puts it on the record beside
//    ours: it is there so a reader can SEE the difference, not because it can catch it here. The
//    machine that catches it is the Windows job in this repository's own checks.

import { strict as assert } from "node:assert";
import { win32 } from "node:path";
import { test } from "node:test";

import { underPrefix } from "../src/drive-paths.ts";

test("a descendant loses its folder's own path and keeps the rest", () => {
  assert.equal(underPrefix("deep", "deep/under.txt"), "under.txt");
  assert.equal(underPrefix("a/b", "a/b/c/d.txt"), "c/d.txt");
  assert.equal(underPrefix("a/b/", "a/b/c/d.txt"), "c/d.txt", "a trailing slash is the same prefix");
});

test("no prefix means the path is already what it should be", () => {
  assert.equal(underPrefix("", "deep/under.txt"), "deep/under.txt");
});

test("a path that is not under the prefix comes back untouched", () => {
  // The caller decides what that means; silently producing something plausible would hide it.
  assert.equal(underPrefix("deep", "other/under.txt"), "other/under.txt");
  assert.equal(underPrefix("deep", "deeper/under.txt"), "deeper/under.txt", "a prefix is a folder, not a string start");
});

test("⛔ the answer is in drive separators on every platform — which is what node:path is not", () => {
  const prefix = "deep";
  const path = "deep/under.txt";
  assert.equal(
    win32.relative(prefix, path),
    "under.txt",
    "setup: this is what the old code asked for",
  );
  const nested = win32.relative("a", "a/b/c.txt");
  assert.equal(nested, "b\\c.txt", "setup: on Windows node:path answers in backslashes");
  assert.equal(underPrefix("a", "a/b/c.txt"), "b/c.txt", "this module must not do that");
  assert.doesNotMatch(underPrefix("a", "a/b/c.txt"), /\\/, "a drive path never carries a backslash");
});
