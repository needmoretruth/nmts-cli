// `nmts usage` against a real local server. No fetch mocking: the list is sealed with the engine
// and opened by the command, so what is measured is the arithmetic over what really came off the
// wire.
//
// ⛔ THE CASES ARE THE COUNTING RULES, and the one that matters most is the one nobody sees:
//    being in the trash is INHERITED, so a file under a trashed folder is trash even though
//    nothing marked the file. A report that read each entry's own mark would count those bytes as
//    live — telling somebody they are holding files the server has already stopped serving.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { usage } from "../src/commands/usage.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

/** One field of something parsed off the wire, without claiming to know its shape. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** The one JSON object the command printed. */
function answer(lines: readonly string[]): unknown {
  return JSON.parse(lines.join(""));
}

/** The `path` of every row in `biggest`, in the order they were printed. */
function biggestPaths(parsed: unknown): string[] {
  const rows: unknown = field(parsed, "biggest");
  assert.ok(Array.isArray(rows), "the answer carried no biggest list");
  return rows.map((row: unknown) => {
    const path: unknown = field(row, "path");
    assert.equal(typeof path, "string", "a biggest row had no path");
    return String(path);
  });
}

test("⛔ the total is the live drive, and what is in the trash is its own figure", async () => {
  await withSandbox(drive, "usage-totals", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "photos" }),
      entry({ id: "f1", name: "beach.jpg", parentId: "d1", size: 100 }),
      entry({ id: "f2", name: "notes.txt", size: 200 }),
      entry({ id: "f3", name: "old.bin", size: 900, deletedAt: 1 }),
    ]);
    const out = collect();
    assert.equal(await usage(opts(out)), 0);
    const text = out.lines.join("\n");
    assert.match(text, /2 files · 1 folder · 300 B/);
    assert.match(text, /In the trash: 1 file · 900 B/);
    assert.ok(!text.includes("1.1 kB"), "the trashed bytes were folded into the total");

    const json = collect();
    await usage({ ...opts(json), json: true });
    const parsed = answer(json.lines);
    assert.equal(field(parsed, "files"), 2);
    assert.equal(field(parsed, "folders"), 1);
    assert.equal(field(parsed, "bytes"), 300);
    assert.equal(field(parsed, "trashedFiles"), 1);
    assert.equal(field(parsed, "trashedBytes"), 900);
  });
});

test("⛔ a file under a trashed folder is counted as trash, though nothing marked the file", async () => {
  await withSandbox(drive, "usage-inherited", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "thrown-away", deletedAt: 1 }),
      entry({ id: "f1", name: "inside.bin", parentId: "d1", size: 500 }),
      entry({ id: "f2", name: "kept.txt", size: 10 }),
    ]);
    const out = collect();
    await usage({ ...opts(out), json: true });
    const parsed = answer(out.lines);
    assert.equal(field(parsed, "files"), 1, "a file under a trashed folder was counted as live");
    assert.equal(field(parsed, "bytes"), 10, "bytes the server no longer serves were counted as held");
    assert.equal(field(parsed, "folders"), 0, "a trashed folder was counted as a live folder");
    // One trashed FILE: the folder above it is a folder, and folders hold no bytes and are not
    // files in either count.
    assert.equal(field(parsed, "trashedFiles"), 1);
    assert.equal(field(parsed, "trashedBytes"), 500);
  });
});

test("the largest files come out largest first, ties by name, with the path `get` accepts", async () => {
  await withSandbox(drive, "usage-biggest", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "photos" }),
      // Two of one size: the tie is broken by the name, so `also` leads `big`.
      entry({ id: "f1", name: "big.bin", parentId: "d1", size: 900 }),
      entry({ id: "f2", name: "also.bin", parentId: "d1", size: 900 }),
      entry({ id: "f3", name: "c.bin", size: 700 }),
      entry({ id: "f4", name: "d.bin", size: 500 }),
      entry({ id: "f5", name: "e.bin", size: 300 }),
      // A sixth file, so the list has to stop somewhere.
      entry({ id: "f6", name: "f.bin", size: 100 }),
      // And a trashed one larger than every live file: it is not part of the drive.
      entry({ id: "f7", name: "huge.bin", size: 9_000, deletedAt: 1 }),
    ]);
    const out = collect();
    await usage({ ...opts(out), json: true });
    assert.deepEqual(biggestPaths(answer(out.lines)), [
      "photos/also.bin",
      "photos/big.bin",
      "c.bin",
      "d.bin",
      "e.bin",
    ]);

    const printed = collect();
    await usage(opts(printed));
    const text = printed.lines.join("\n");
    assert.match(text, /Largest/);
    assert.match(text, /photos\/also\.bin/, "a nested file must be named by its path");
    assert.ok(!text.includes("f.bin"), "the sixth largest file was printed");
    assert.ok(!text.includes("huge.bin"), "a trashed file was named as one of the largest");
  });
});

test("--json says which version of the list it counted", async () => {
  await withSandbox(drive, "usage-seq", async (code) => {
    await drive.serve(code, [entry({ id: "f1", name: "a.txt", size: 10 })]);
    const out = collect();
    await usage({ ...opts(out), json: true });
    const parsed = answer(out.lines);
    assert.equal(field(parsed, "state"), "present");
    assert.equal(field(parsed, "seq"), 1);
  });
});

test("an account with no list says so, and --json answers zeros rather than a missing shape", async () => {
  await withSandbox(drive, "usage-absent", async () => {
    const out = collect();
    assert.equal(await usage(opts(out)), 0);
    assert.match(out.lines.join("\n"), /no file list yet/);

    const json = collect();
    await usage({ ...opts(json), json: true });
    const parsed = answer(json.lines);
    assert.equal(field(parsed, "state"), "absent");
    assert.equal(field(parsed, "files"), 0);
    assert.equal(field(parsed, "bytes"), 0);
    assert.equal(field(parsed, "trashedBytes"), 0);
    assert.deepEqual(biggestPaths(parsed), []);
  });
});
