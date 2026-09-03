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

import { setMode } from "../src/autonomy.ts";
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

test("⛔ a mode that lets an agent decide cannot roll the file list back", async () => {
  await withSandbox(drive, "rollback-mode", async (code) => {
    await twoVersions(code);
    setMode("auto", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    try {
      const failure = await rollback(opts(collect())).then(() => null, (e: unknown) => e);
      assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
      assert.equal(failure.message, "Rolling the file list back is a person's act.");
      assert.equal(
        failure.nextStep,
        "Run `nmts rollback` yourself, outside mode auto and without --skip-permissions.",
      );
      assert.equal(failure.exitCode, 5);
      assert.deepEqual(drive.calls, [], `it asked the server: ${drive.calls.join(" · ")}`);
    } finally {
      setMode("off", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    }
  });
});

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
