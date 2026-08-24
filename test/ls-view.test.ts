// What `nmts ls` SHOWS and in WHAT ORDER — `--find`, `--sort`, `--desc` — against a real local
// server, with lists sealed by the engine like every other suite here.
//
// ⛔ THE TWO NEW WAYS OF SHOWING LESS ARE HELD TO THE TRASH RULE. A listing that quietly omits
//    things is how somebody concludes a file is gone, so a narrowed listing has to say it narrowed
//    and a reordered one has to keep every row. Both are asserted on the printed text, not only on
//    `--json`: the text is what a person reads.
//
// ⛔ AND A WRONG OPTION MUST COST NO ROUND TRIP. `drive.calls` is what proves it — an assertion on
//    the exit code alone would pass just as well for a version that fetched the whole account
//    first and only then noticed the command line was unusable.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { ls } from "../src/commands/ls.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

/**
 * The paths in a `--json` listing, in the order they were printed.
 *
 * ⚠ Narrowed rather than asserted: a listing that changes shape must fail here, in the test that
 *   reads it, instead of quietly becoming a list of `undefined` that every case still passes.
 */
function pathsOf(lines: readonly string[]): string[] {
  const parsed: unknown = JSON.parse(lines.join(""));
  const entries: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "entries") : undefined;
  assert.ok(Array.isArray(entries), "the listing carried no entries array");
  return entries.map((row: unknown) => {
    const path: unknown = typeof row === "object" && row !== null ? Reflect.get(row, "path") : undefined;
    assert.equal(typeof path, "string", "an entry had no path");
    return String(path);
  });
}

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

// ── --find ────────────────────────────────────────────────────────────────────────────────────

test("⛔ --find keeps the folders on the way to a match, and drops the ones holding none", async () => {
  await withSandbox(drive, "ls-find", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "photos" }),
      folder({ id: "d2", name: "2026", parentId: "d1" }),
      entry({ id: "f1", name: "beach.jpg", parentId: "d2" }),
      entry({ id: "f2", name: "notes.txt" }),
      // ⛔ A FOLDER WHOSE OWN NAME MATCHES AND HOLDS NOTHING. It is not a result: the query names
      //    files, and printing this row would be an empty folder nobody asked about.
      folder({ id: "d3", name: "beachwear" }),
    ]);
    const out = collect();
    assert.equal(await ls({ ...opts(out), json: true, find: "beach" }), 0);
    assert.deepEqual(pathsOf(out.lines).sort(), ["photos", "photos/2026", "photos/2026/beach.jpg"]);
  });
});

test("--find matches whatever the case, and the listing says how much it left out", async () => {
  await withSandbox(drive, "ls-find-case", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "photos" }),
      entry({ id: "f1", name: "Beach.jpg", parentId: "d1" }),
      entry({ id: "f2", name: "notes.txt" }),
      entry({ id: "f3", name: "receipts.pdf" }),
    ]);
    const out = collect();
    await ls({ ...opts(out), find: "BEACH" });
    const text = out.lines.join("\n");
    assert.match(text, /photos\/Beach\.jpg/, "a differently-cased name must still match");
    assert.ok(!text.includes("notes.txt"), "a file that does not match was listed");
    // ⛔ A NARROWED LISTING SAYS SO. Without these two lines the table above cannot be told apart
    //    from a drive that holds three fewer things than it does.
    assert.match(text, /Without --find this listing would also have shown 2 other files/);
    assert.match(text, /folders holding none are not listed/);
  });
});

test("⛔ --find with nothing to look for is refused before the account is touched", async () => {
  await withSandbox(drive, "ls-find-empty", async () => {
    const failure = await refusal(ls({ ...opts(collect()), find: "   " }));
    assert.equal(failure.exitCode, 2);
    assert.deepEqual(drive.calls, [], "a wrong command line cost a round trip to the account");
  });
});

test("a query nothing matches says so, rather than reading as an empty account", async () => {
  await withSandbox(drive, "ls-find-none", async (code) => {
    await drive.serve(code, [entry({ id: "f1", name: "notes.txt" })]);
    const out = collect();
    assert.equal(await ls({ ...opts(out), find: "beach" }), 0);
    const text = out.lines.join("\n");
    assert.match(text, /No file in this account has "beach" in its name/);
    assert.ok(!text.includes("The file list is empty"), "a filtered listing read as an empty drive");
  });
});

test("--find searches the drive, not the trash, and says the trash was left out of it", async () => {
  await withSandbox(drive, "ls-find-trash", async (code) => {
    await drive.serve(code, [
      entry({ id: "f1", name: "beach.jpg" }),
      entry({ id: "f2", name: "beach-old.jpg", deletedAt: 1 }),
    ]);
    const out = collect();
    await ls({ ...opts(out), find: "beach" });
    const text = out.lines.join("\n");
    assert.ok(!text.includes("beach-old.jpg"), "a trashed file answered a search of the drive");
    assert.match(text, /1 in the trash, not searched/);

    const all = collect();
    await ls({ ...opts(all), find: "beach", all: true });
    assert.match(all.lines.join("\n"), /beach-old\.jpg/, "--all did not widen the search");
  });
});

// ── --sort · --desc ───────────────────────────────────────────────────────────────────────────

test("⛔ --sort puts folders above files and orders each group; --desc is the exact reverse", async () => {
  await withSandbox(drive, "ls-sort", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "zoo" }),
      folder({ id: "d2", name: "alps" }),
      entry({ id: "f1", name: "big.bin", size: 900, createdAt: 3 }),
      entry({ id: "f2", name: "small.bin", size: 10, createdAt: 1 }),
      entry({ id: "f3", name: "middle.bin", size: 100, createdAt: 2 }),
    ]);
    const run = async (over: { sort: string; desc?: boolean }): Promise<string[]> => {
      const out = collect();
      await ls({ ...opts(out), json: true, ...over });
      return pathsOf(out.lines);
    };
    assert.deepEqual(await run({ sort: "size" }), ["alps", "zoo", "small.bin", "middle.bin", "big.bin"]);
    assert.deepEqual(await run({ sort: "size", desc: true }), ["zoo", "alps", "big.bin", "middle.bin", "small.bin"]);
    assert.deepEqual(await run({ sort: "date" }), ["alps", "zoo", "small.bin", "middle.bin", "big.bin"]);
    assert.deepEqual(await run({ sort: "name" }), ["alps", "zoo", "big.bin", "middle.bin", "small.bin"]);

    // And the TABLE follows it too — the order is not something only `--json` gets. The first row
    // is the discriminating one: in the order the list was written, `zoo` comes first.
    const printed = collect();
    await ls({ ...opts(printed), sort: "size" });
    const text = printed.lines.join("\n");
    assert.match(printed.lines[0] ?? "", /^alps/, "the table did not start where --sort put the first row");
    assert.ok(text.indexOf("small.bin") < text.indexOf("big.bin"), "the table ignored --sort");
    assert.ok(text.indexOf("zoo") < text.indexOf("small.bin"), "a file was printed above the folders");
  });
});

test("the default order is still whole paths ascending, and --desc reverses that", async () => {
  await withSandbox(drive, "ls-default-order", async (code) => {
    await drive.serve(code, [
      folder({ id: "d1", name: "photos" }),
      entry({ id: "f1", name: "beach.jpg", parentId: "d1" }),
      entry({ id: "f2", name: "notes.txt" }),
    ]);
    const asc = collect();
    await ls({ ...opts(asc), json: true });
    assert.deepEqual(pathsOf(asc.lines), ["notes.txt", "photos", "photos/beach.jpg"]);
    const desc = collect();
    await ls({ ...opts(desc), json: true, desc: true });
    assert.deepEqual(pathsOf(desc.lines), ["photos/beach.jpg", "photos", "notes.txt"]);
  });
});

test("⛔ a key this cannot sort by is refused before the account is touched", async () => {
  await withSandbox(drive, "ls-sort-unknown", async () => {
    const failure = await refusal(ls({ ...opts(collect()), sort: "largest" }));
    assert.equal(failure.exitCode, 2);
    assert.match(`${failure.message} ${failure.nextStep ?? ""}`, /name.*size.*date/);
    assert.deepEqual(drive.calls, [], "a wrong command line cost a round trip to the account");
  });
});
