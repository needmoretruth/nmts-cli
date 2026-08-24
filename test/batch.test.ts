// Many paths in one command — `mv`, `rm` and `restore` when more than one thing is named.
//
// ⛔ THE ASSERTION THAT CARRIES THIS FILE IS `drive.written.length`. "Everything ended up in the
//    right place" is true of a run that wrote the list once per path, and that run is one lost
//    compare-and-swap away from a drive holding half of what was asked for — with a message that
//    says the whole thing happened. Counting the writes is the only way to tell the two apart.
//
// ⛔ AND THE RACE IS REAL HERE, not simulated. `otherDeviceWrites` makes the fake server hand back
//    one genuine version conflict at the moment the tool tries to write, so the retry path runs on
//    the real refusal, in the real order, against a list the tool never saw when it decided.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { mv } from "../src/commands/organise.ts";
import { restore, rm } from "../src/commands/trash.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});
const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

// ── mv ────────────────────────────────────────────────────────────────────────────────────────

test("mv takes many paths and writes the file list once", async () => {
  await withSandbox(drive, "batch-mv", async (code) => {
    await drive.serve(code, [
      folder({ id: "D", name: "archive" }),
      entry({ id: "a", name: "a.txt" }),
      entry({ id: "b", name: "b.txt" }),
      entry({ id: "c", name: "c.txt" }),
    ]);
    const out = collect();
    assert.equal(await mv(["a.txt", "b.txt", "c.txt", "archive"], opts(out)), 0);

    // ⛔ ONE write, not three. Three would also leave all three files in the folder.
    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);
    const after_ = await drive.lastWritten(code);
    for (const id of ["a", "b", "c"]) {
      assert.equal(after_.find((e) => e.id === id)?.parentId, "D", `${id} was left behind`);
    }
    assert.match(out.lines.join("\n"), /"a\.txt", "b\.txt", "c\.txt"/);
  });
});

test("⛔ two files with one name, moved into one folder, are refused — not written on top of each other", async () => {
  await withSandbox(drive, "batch-mv-collide", async (code) => {
    await drive.serve(code, [
      folder({ id: "D", name: "archive" }),
      folder({ id: "S1", name: "one" }),
      folder({ id: "S2", name: "two" }),
      entry({ id: "a", name: "notes.txt", parentId: "S1" }),
      entry({ id: "b", name: "notes.txt", parentId: "S2" }),
    ]);
    // Neither name is taken in `archive` when the run starts, so a check made against the list as
    // it was READ says yes to both — and the drive ends with two entries at `archive/notes.txt`,
    // which no command in this tool can then address.
    const failure = await refusal(mv(["one/notes.txt", "two/notes.txt", "archive"], opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /already in that folder/);
    assert.equal(drive.written.length, 0, "it wrote a list with two entries at one path");
  });
});

test("⛔ a batched move that loses the race decides again rather than re-applying", async () => {
  await withSandbox(drive, "batch-mv-race", async (code) => {
    await drive.serve(code, [
      folder({ id: "S", name: "src" }),
      folder({ id: "D", name: "dst" }),
      entry({ id: "t1", name: "one", parentId: "S" }),
      entry({ id: "t2", name: "two", parentId: "S" }),
    ]);
    // While the tool is writing, another device puts something called "two" in the destination.
    await drive.otherDeviceWrites(code, [
      folder({ id: "S", name: "src" }),
      folder({ id: "D", name: "dst" }),
      entry({ id: "t1", name: "one", parentId: "S" }),
      entry({ id: "t2", name: "two", parentId: "S" }),
      entry({ id: "other", name: "two", parentId: "D" }),
    ]);

    const failure = await refusal(mv(["src/one", "src/two", "dst"], opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.equal(drive.written.length, 0, "it re-applied a decision taken against the older list");
  });
});

test("mv leaves alone what is already in the destination, and says so", async () => {
  await withSandbox(drive, "batch-mv-already", async (code) => {
    await drive.serve(code, [
      folder({ id: "D", name: "archive" }),
      entry({ id: "a", name: "a.txt" }),
      entry({ id: "b", name: "b.txt", parentId: "D" }),
    ]);
    const out = collect();
    assert.equal(await mv(["a.txt", "archive/b.txt", "archive"], opts(out)), 0);
    assert.equal(drive.written.length, 1);
    assert.equal((await drive.lastWritten(code)).find((e) => e.id === "a")?.parentId, "D");
    assert.match(out.lines.join("\n"), /"b\.txt" was already there/);
  });
});

// ── rm ────────────────────────────────────────────────────────────────────────────────────────

test("rm takes many paths, writes once, and deletes every row underneath them", async () => {
  await withSandbox(drive, "batch-rm", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos" }),
      entry({ id: "in", name: "in.jpg", parentId: "F" }),
      entry({ id: "a", name: "a.txt" }),
      entry({ id: "keep", name: "keep.txt" }),
    ]);
    const out = collect();
    assert.equal(await rm(["photos", "a.txt"], opts(out)), 0);

    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);
    assert.ok(drive.calls.includes("DELETE /v1/items/in"), `a file inside the folder kept its row`);
    assert.ok(drive.calls.includes("DELETE /v1/items/a"));
    // ⛔ Discriminating: a version that deleted every row would also pass the two above.
    assert.ok(!drive.calls.includes("DELETE /v1/items/keep"), "it deleted a row nobody named");

    const after_ = await drive.lastWritten(code);
    assert.ok(after_.find((e) => e.id === "F")?.deletedAt !== undefined, "the folder is not trashed");
    assert.ok(after_.find((e) => e.id === "a")?.deletedAt !== undefined, "the file is not trashed");
    assert.equal(after_.find((e) => e.id === "in")?.deletedAt, undefined, "a child was stamped");
  });
});

test("⛔ naming a folder and something inside it does not give the child a clock of its own", async () => {
  await withSandbox(drive, "batch-rm-covered", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos" }),
      entry({ id: "in", name: "in.jpg", parentId: "F" }),
    ]);
    const out = collect();
    assert.equal(await rm(["photos", "photos/in.jpg"], opts(out)), 0);

    const after_ = await drive.lastWritten(code);
    // Stamping the child too would detach it from the folder it went with: restoring the folder
    // afterwards would leave it behind, and only somebody who remembered naming it separately
    // would ever find it again.
    assert.equal(after_.find((e) => e.id === "in")?.deletedAt, undefined, "the child was stamped");
    assert.ok(after_.find((e) => e.id === "F")?.deletedAt !== undefined);
    assert.match(out.lines.join("\n"), /goes with it/);
  });
});

test("⛔ a batched trash that loses the race does not stamp what the winner already put in the trash", async () => {
  await withSandbox(drive, "batch-rm-race", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos" }),
      entry({ id: "a", name: "a.txt" }),
      entry({ id: "b", name: "b.txt" }),
    ]);
    // While the tool is writing, another device trashes the folder AND moves b.txt into it. From
    // that moment b.txt is in the trash by inheritance, carrying the folder's instant.
    await drive.otherDeviceWrites(code, [
      folder({ id: "F", name: "photos", deletedAt: 9 }),
      entry({ id: "a", name: "a.txt" }),
      entry({ id: "b", name: "b.txt", parentId: "F" }),
    ]);

    const out = collect();
    assert.equal(await rm(["a.txt", "b.txt"], opts(out)), 0);

    const after_ = await drive.lastWritten(code);
    assert.ok(after_.find((e) => e.id === "a")?.deletedAt !== undefined, "the live one was not trashed");
    // ⛔ Re-applying the intent built against the older list would stamp b.txt with its own
    //    instant, quietly detaching it from the folder it is now inside: restoring that folder
    //    would leave it behind for good.
    assert.equal(
      after_.find((e) => e.id === "b")?.deletedAt,
      undefined,
      "it stamped something that was already in the trash by inheritance",
    );
  });
});

test("⛔ one path that names nothing refuses the whole run, before a single row is touched", async () => {
  await withSandbox(drive, "batch-rm-refuse", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const failure = await refusal(rm(["a.txt", "gone.txt"], opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.equal(drive.written.length, 0, "it trashed part of a run it could not finish");
    assert.equal(
      drive.calls.filter((c) => c.startsWith("DELETE")).length,
      0,
      "it deleted a row for a run it was going to refuse",
    );
  });
});

test("rm --json names every path and every id it acted on", async () => {
  await withSandbox(drive, "batch-rm-json", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" }), entry({ id: "b", name: "b.txt" })]);
    const out = collect();
    assert.equal(await rm(["a.txt", "b.txt"], { ...opts(out), json: true }), 0);
    const said = JSON.parse(out.lines.join("")) as {
      paths: string[];
      ids: string[];
      files: number;
      changed: boolean;
    };
    assert.deepEqual(said.paths, ["a.txt", "b.txt"]);
    assert.deepEqual(said.ids, ["a", "b"]);
    assert.equal(said.files, 2);
    assert.equal(said.changed, true);
  });
});

// ── restore ───────────────────────────────────────────────────────────────────────────────────

test("restore takes many paths and writes once", async () => {
  await withSandbox(drive, "batch-restore", async (code) => {
    await drive.serve(code, [
      entry({ id: "a", name: "a.txt", deletedAt: 5 }),
      entry({ id: "b", name: "b.txt", deletedAt: 6 }),
    ]);
    const out = collect();
    assert.equal(await restore(["a.txt", "b.txt"], opts(out)), 0);

    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);
    const after_ = await drive.lastWritten(code);
    assert.equal(after_.find((e) => e.id === "a")?.deletedAt, undefined);
    assert.equal(after_.find((e) => e.id === "b")?.deletedAt, undefined);
    assert.ok(drive.calls.includes("POST /v1/items/a/restore"));
    assert.ok(drive.calls.includes("POST /v1/items/b/restore"));
  });
});

test("restore names what was not in the trash instead of refusing the run over it", async () => {
  await withSandbox(drive, "batch-restore-live", async (code) => {
    await drive.serve(code, [
      entry({ id: "a", name: "a.txt", deletedAt: 5 }),
      entry({ id: "b", name: "b.txt" }),
    ]);
    const out = collect();
    assert.equal(await restore(["a.txt", "b.txt"], opts(out)), 0);
    assert.equal(drive.written.length, 1);
    assert.equal((await drive.lastWritten(code)).find((e) => e.id === "a")?.deletedAt, undefined);
    // Already in the state that was asked for is not a refusal — it is named and left alone.
    assert.match(out.lines.join("\n"), /"b\.txt" was not in the trash/);
  });
});
