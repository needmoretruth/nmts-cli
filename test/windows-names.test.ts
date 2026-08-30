// A name that is legal in the drive is not always a name this machine can hold.
//
// ⛔ WHY THIS IS WORTH CODE (2026-08-30). Windows keeps `NUL`, `CON`, `COM1` and a few
//    more for devices. Opening one SUCCEEDS: every byte written is accepted and nothing is stored.
//    So a drive holding a file called `NUL`, pulled onto Windows, printed a success line and left
//    the person with nothing — the failure mode this product exists to prevent, arriving through
//    a file name. A colon is worse than silent: it writes an alternate data stream on a different
//    file, where nothing lists it.
//
// ⚠ AND SAY WHAT THIS FILE CANNOT DO. It cannot reproduce the Windows failure on Linux — the same
//   limit `drive-paths.test.ts` states about separators. So the rule takes the platform as a
//   parameter and these tests ask the Windows question explicitly. The machine that would catch a
//   regression in the real call sites is the Windows job in the published repository's checks.
import { strict as assert } from "node:assert";
import test from "node:test";

import { refuseUnwritableName, unwritableOn } from "../src/safe-path.ts";
import { safeJoin } from "../src/commands/pull.ts";

test("the device names Windows keeps are refused there and nowhere else", () => {
  for (const name of ["NUL", "nul", "CON", "aux", "COM1", "LPT9", "NUL.txt", "con.tar.gz", "aux.iliary", "com0"]) {
    assert.notEqual(unwritableOn(name, "win32"), null, `${name} must be refused on Windows`);
    assert.equal(unwritableOn(name, "linux"), null, `${name} is an ordinary name on Linux`);
    assert.equal(unwritableOn(name, "darwin"), null, `${name} is an ordinary name on macOS`);
  }
});

test("a name that is not a device is not refused, however close it looks", () => {
  // ⚠ `aux.iliary` is NOT in this list, and that is the point: an extension does not save a
  //   reserved name. It is in the refused list above.
  for (const name of ["NULL", "console.log", "com10", "lpt", "nuls", "connection"]) {
    assert.equal(unwritableOn(name, "win32"), null, `${name} is a file, not a device`);
  }
});

test("the characters Windows cannot hold — and the colon that writes somewhere else", () => {
  for (const name of ['a"b', "a<b", "a>b", "a|b", "a?b", "a*b", "notes:secret"]) {
    assert.notEqual(unwritableOn(name, "win32"), null, `${name} must be refused on Windows`);
  }
  // ⭐ Discriminating: the colon's reason must name the hidden stream, because that is the part a
  //    person cannot discover afterwards.
  assert.match(unwritableOn("notes:secret", "win32") ?? "", /stream/);
});

test("a trailing dot or space is not the name it looks like", () => {
  for (const name of ["report.", "report "]) {
    assert.notEqual(unwritableOn(name, "win32"), null, `${name} does not survive on Windows`);
  }
  assert.equal(unwritableOn("report.txt", "win32"), null);
});

test("the refusal says what was not written and what to do instead", () => {
  assert.throws(
    () => refuseUnwritableName("NUL", "win32"),
    (err: unknown) => {
      const e = err as { message: string; exitCode: number; nextStep: string | null };
      assert.match(e.message, /NUL/, "the name has to be in the message");
      assert.equal(e.exitCode, 4);
      assert.match(e.nextStep ?? "", /Nothing was written/);
      assert.match(e.nextStep ?? "", /Rename it in the drive/);
      return true;
    },
  );
  // On this machine the same name is fine, and the rule must not fire.
  assert.doesNotThrow(() => refuseUnwritableName("NUL", "linux"));
});

// ⛔ THE FAILURE THIS PINS HAPPENED. A climbing segment — `..` — also ends in a dot, and a dot at
//    the end is one of the shapes Windows silently drops. With the platform check running first,
//    an attempt to escape the destination reported itself as a naming problem, and only on
//    Windows: on Linux the same input took the other branch and the test that covers it passed.
//    So this drives the Windows branch from any machine, which is what was missing.
test("⛔ climbing out is refused for climbing out, on Windows too", () => {
  for (const platform of ["win32", "linux"] as const) {
    assert.throws(
      () => safeJoin("/tmp/dest", "a/../../etc/passwd", platform),
      /cannot be written to a path/,
      `on ${platform}`,
    );
  }
});

test("a name Windows cannot keep is still refused for that reason", () => {
  assert.throws(() => safeJoin("/tmp/dest", "notes/CON.txt", "win32"), /cannot be written on this system/);
  assert.doesNotThrow(() => safeJoin("/tmp/dest", "notes/CON.txt", "linux"));
});
