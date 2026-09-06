// `nmts rollback` — the version before, put back as the current one.
//
// ⛔ THE BYTES THAT LAND ARE THE ONES THE SERVER WAS RETAINING, and that is what is asserted: the
//    list this run wrote is opened with the engine and compared against the older version's
//    entries. A command that wrote anything else would print the same sentence.
//
// ⛔ AND BOTH REFUSALS ARE HERE. One is a person's act being asked for by a mode; the other is an
//    account with nothing to go back to, where the wrong answer is to write something.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { rollback } from "../src/commands/rollback.ts";
import { collect, entry, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

/** A drive whose current list is version 2 and whose retained one is version 1. */
async function twoVersions(code: string): Promise<void> {
  await drive.servePrevious(code, [entry({ id: "a", name: "a.txt" })], 1);
  await drive.serve(code, [entry({ id: "a", name: "a.txt" }), entry({ id: "b", name: "b.txt" })], 2);
}

test("an account with nothing retained is refused, and pointed at the command that does help", async () => {
  await withSandbox(drive, "rollback-none", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const failure = await rollback({ ...opts(collect()), yes: true }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
    assert.equal(failure.message, "The server holds no previous version of the file list.");
    assert.equal(
      failure.nextStep,
      "Nothing was changed. `nmts rebuild` builds a list from the server's rows when there is no " +
        "list to go back to.",
    );
    assert.equal(failure.exitCode, 4);
    assert.equal(drive.written.length, 0, "it wrote a list for an account with nothing to go back to");
  });
});

test("without --yes it reports what it would do, changes nothing, and waits", async () => {
  await withSandbox(drive, "rollback-asks", async (code) => {
    await twoVersions(code);
    const out = collect();
    assert.equal(await rollback(opts(out)), 5);
    assert.equal(drive.written.length, 0, "it wrote the list without being told to go ahead");
    assert.match(out.lines.join("\n"), /Version 1 of the file list would go back/);
    assert.match(out.lines.join("\n"), /Nothing was changed\. To go ahead: {2}nmts rollback --yes/);
  });
});

test("with --yes the retained version becomes the current one, and the sentence says what that cost", async () => {
  await withSandbox(drive, "rollback-does", async (code) => {
    await twoVersions(code);
    const out = collect();
    assert.equal(await rollback({ ...opts(out), yes: true }), 0);
    assert.deepEqual(out.lines, [
      "Put version 1 of the file list back as the current one, over version 2. What version 2 " +
        "added is out of the list now; the bytes are still stored, and `nmts rebuild` finds files " +
        "the list does not name.",
    ]);

    // ⛔ The list that landed is the older one, opened with the engine rather than believed.
    const written = await drive.lastWritten(code);
    assert.deepEqual(written.map((e) => e.id), ["a"]);
  });
});

test("--json says which version came back and which one it replaced", async () => {
  await withSandbox(drive, "rollback-json", async (code) => {
    await twoVersions(code);
    const out = collect();
    assert.equal(await rollback({ ...opts(out), yes: true, json: true }), 0);
    assert.deepEqual(JSON.parse(out.lines.join("")), { restored_seq: 1, replaced_seq: 2 });
  });
});

test("⛔ the unconfirmed answer never uses the words the finished act uses", async () => {
  await withSandbox(drive, "rollback-json-asks", async (code) => {
    await twoVersions(code);
    const out = collect();
    assert.equal(await rollback({ ...opts(out), json: true }), 5);
    const said: unknown = JSON.parse(out.lines.join(""));
    assert.deepEqual(said, { previous_seq: 1, current_seq: 2, changed: false });
    assert.equal(drive.written.length, 0, "it wrote the list without being told to go ahead");
  });
});

test("a retained list in parts goes back named, and not one part is uploaded", async () => {
  await withSandbox(drive, "rollback-chunked", async (code) => {
    // The retained version is an index in two parts; the current one is an ordinary later list.
    await drive.servePreviousChunked(
      code,
      [[entry({ id: "a", name: "a.txt" })], [entry({ id: "b", name: "b.txt" })]],
      1,
    );
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })], 2);

    assert.equal(await rollback({ ...opts(collect()), yes: true }), 0);

    // ⛔ THE NAMES TRAVEL, THE BYTES DO NOT. The server keeps what the retained index names, so a
    //    rollback has nothing to upload — but a write that named nothing would let the server free
    //    the very chunks it just put back, and the restored list would open into a drive missing
    //    files.
    const write = drive.chunks.indexWrites.at(-1);
    assert.equal(write?.refs.length, 2, `the older index's parts were not named — ${String(write?.refs)}`);
    assert.equal(
      drive.calls.filter((c) => c.startsWith("PUT /v1/manifest/chunks/")).length,
      0,
      "it uploaded a part the server already holds",
    );
    assert.deepEqual((await drive.lastWritten(code)).map((e) => e.name), ["a.txt", "b.txt"]);
  });
});
