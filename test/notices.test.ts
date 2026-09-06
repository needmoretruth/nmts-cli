// `nmts notices` against a real local server: the board, one notice, and a copy kept as a file.
//
// ⛔ THE ID IS ASSERTED, NOT JUST THE TITLE. A listing whose lines a person cannot act on is a
//    listing that fails silently — they read a headline, ask for it by name, and are refused. So
//    every line carries the id the body address takes, and this test reads it back out.
//
// ⛔ AND THE REFUSALS ARE THE POINT OF THE REST. An unknown id must name the command that shows
//    the ids there are; a name already on disk must NOT be written over, because the copy already
//    there is somebody's record of what they were told and when.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { notices } from "../src/commands/documents.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, startFakeDrive } from "./fake-drive.ts";
import { NOTICE_ROWS, NOTICE_TEXT } from "./fake-docs.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({ server: drive.base, write: out.write });

test("the board lists a line per notice, with the id the body address takes", async () => {
  const out = collect();
  assert.equal(await notices(opts(out)), 0);
  assert.deepEqual(out.lines, [
    "2026-09-03  terms-v12  New Terms of Service take effect on 10 September",
    "2026-09-01  maintenance-0901  Uploads paused for one hour",
    "",
    "Read one with `nmts notices <id>`, or keep it as a dated file with `nmts notices --save <id>`.",
  ]);
});

test("--json hands back what the server sent, unchanged", async () => {
  const out = collect();
  assert.equal(await notices({ ...opts(out), json: true }), 0);
  // The whole row survives — the kind and the banner date a page renders are still there, which
  // is what "as the server gives it" has to mean for a caller that renders a view of its own.
  assert.deepEqual(JSON.parse(out.lines.join("")), { notices: NOTICE_ROWS });
});

test("an id prints that notice's own text", async () => {
  const out = collect();
  assert.equal(await notices({ ...opts(out), id: "maintenance-0901" }), 0);
  assert.deepEqual(out.lines, ["NMTS notice 2026-09-01\n\nUploads paused for one hour."]);
});

test("--save writes the server's own file name, and says where", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-notices-"));
  try {
    const out = collect();
    assert.equal(await notices({ ...opts(out), id: "terms-v12", save: true, out: dir }), 0);
    const expected = join(dir, "nmts-notice-2026-09-03-terms-v12.txt");
    assert.deepEqual(out.lines, [`Wrote ${expected}`]);
    // ⛔ BYTE FOR BYTE, including the last newline. A copy kept from here and a copy kept from the
    //    browser's download button are meant to be the same file.
    assert.equal(readFileSync(expected, "utf8"), NOTICE_TEXT["terms-v12"]?.text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--save refuses to write over a copy already there, and names it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-notices-"));
  try {
    const taken = join(dir, "nmts-notice-2026-09-03-terms-v12.txt");
    writeFileSync(taken, "the copy somebody already kept");
    const out = collect();
    await assert.rejects(
      () => notices({ ...opts(out), id: "terms-v12", save: true, out: dir }),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 4);
        assert.ok(error.message.includes(taken), "the refusal does not name the path");
        assert.match(error.nextStep ?? "", /Nothing was written/);
        return true;
      },
    );
    assert.equal(readFileSync(taken, "utf8"), "the copy somebody already kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an id nothing was posted under is refused, naming the command that lists them", async () => {
  const out = collect();
  await assert.rejects(
    () => notices({ ...opts(out), id: "no-such-notice" }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 4);
      assert.match(error.message, /no-such-notice/);
      assert.match(error.nextStep ?? "", /`nmts notices`/);
      return true;
    },
  );
});

test("--save with no id says which notice to name rather than saving the listing", async () => {
  const out = collect();
  await assert.rejects(
    () => notices({ ...opts(out), save: true }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      assert.match(error.nextStep ?? "", /--save <id>/);
      return true;
    },
  );
});
