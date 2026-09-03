// `nmts label --rename` and `nmts unlabel --all` — one label changed across the whole account.
//
// ⛔ EVERY ASSERTION READS THE SEALED LIST THE TOOL ACTUALLY SENT. A sweep that announced a count
//    and wrote nothing looks identical on the terminal, and these are the two commands where
//    nobody names the files: the count IS the report.
//
// ⛔ AND THE MERGE IS ASSERTED AS ONE COPY. Renaming onto a label a file already wears would
//    otherwise leave that file wearing the same word twice, which shows a doubled row and counts
//    the file twice everywhere labels are counted.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { labelRename, unlabelAll } from "../src/commands/marks.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, entry, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

test("renaming a label changes it on every file that carries it, and counts them", async () => {
  await withSandbox(drive, "sweep-rename", async (code) => {
    await drive.serve(code, [
      entry({ id: "a", name: "a.txt", labels: ["work"] }),
      entry({ id: "b", name: "b.txt", labels: ["work", "tax"] }),
      entry({ id: "c", name: "c.txt" }),
    ]);
    const out = collect();
    assert.equal(await labelRename("work", "archive", opts(out)), 0);
    assert.deepEqual(out.lines, [`Renamed the label "work" to "archive" on 2 files.`]);

    const written = await drive.lastWritten(code);
    assert.deepEqual(written.find((e) => e.id === "a")?.labels, ["archive"]);
    assert.deepEqual(written.find((e) => e.id === "b")?.labels, ["tax", "archive"]);
    assert.equal(written.find((e) => e.id === "c")?.labels, undefined);
  });
});

test("⛔ renaming onto a label a file already wears leaves it with one copy, not two", async () => {
  await withSandbox(drive, "sweep-merge", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", labels: ["work", "archive"] })]);
    const out = collect();
    assert.equal(await labelRename("work", "archive", opts(out)), 0);
    assert.deepEqual(out.lines, [`Renamed the label "work" to "archive" on 1 file.`]);
    assert.deepEqual((await drive.lastWritten(code))[0]?.labels, ["archive"]);
  });
});

test("a label no file carries is said plainly, and nothing is written", async () => {
  await withSandbox(drive, "sweep-rename-none", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", labels: ["work"] })]);
    const out = collect();
    assert.equal(await labelRename("holiday", "archive", opts(out)), 0);
    assert.deepEqual(out.lines, [`No file carries the label "holiday".`]);
    assert.equal(drive.written.length, 0, "it rewrote the list for a label nothing wears");
  });
});

test("taking a label off every file leaves the other labels alone", async () => {
  await withSandbox(drive, "sweep-unlabel", async (code) => {
    await drive.serve(code, [
      entry({ id: "a", name: "a.txt", labels: ["work"] }),
      entry({ id: "b", name: "b.txt", labels: ["work", "tax"] }),
    ]);
    const out = collect();
    assert.equal(await unlabelAll("work", opts(out)), 0);
    assert.deepEqual(out.lines, [`Took the label "work" off 2 files.`]);

    const written = await drive.lastWritten(code);
    // ⛔ Absence, not an empty list: the format spells "no labels" by leaving the field out.
    assert.equal(written.find((e) => e.id === "a")?.labels, undefined);
    assert.deepEqual(written.find((e) => e.id === "b")?.labels, ["tax"]);
  });
});

test("one file reads as one file", async () => {
  await withSandbox(drive, "sweep-unlabel-one", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", labels: ["work"] })]);
    const out = collect();
    assert.equal(await unlabelAll("work", opts(out)), 0);
    assert.deepEqual(out.lines, [`Took the label "work" off 1 file.`]);
  });
});

test("a label nothing carries is said plainly here too, and nothing is written", async () => {
  await withSandbox(drive, "sweep-unlabel-none", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await unlabelAll("work", opts(out)), 0);
    assert.deepEqual(out.lines, [`No file carries the label "work".`]);
    assert.equal(drive.written.length, 0, "it rewrote the list for a label nothing wears");
  });
});

test("--json says which label, what it became, and how many files", async () => {
  await withSandbox(drive, "sweep-json", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", labels: ["work"] })]);
    const renamed = collect();
    assert.equal(await labelRename("work", "archive", { ...opts(renamed), json: true }), 0);
    assert.deepEqual(JSON.parse(renamed.lines.join("")), {
      label: "work",
      renamed_to: "archive",
      files: 1,
    });

    const removed = collect();
    assert.equal(await unlabelAll("archive", { ...opts(removed), json: true }), 0);
    assert.deepEqual(JSON.parse(removed.lines.join("")), { label: "archive", removed_from: 1 });
  });
});

test("a sweep with no label to sweep is a command-line error, not an empty run", async () => {
  await withSandbox(drive, "sweep-no-label", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    for (const run of [
      () => labelRename("work", undefined, opts(collect())),
      () => unlabelAll(undefined, opts(collect())),
    ]) {
      const failure = await run().then(() => null, (e: unknown) => e);
      assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
      assert.equal(failure.exitCode, 2);
    }
  });
});
