// `nmts padding` — reading and changing the rule that decides how coarsely a stored size is hidden.
//
// ⛔ THE SETTING IS ASSERTED THROUGH THE SEALED LIST, not through what the command said. It lives
//    in the blob or nowhere, and a settings field that is declared but carried by neither
//    direction of the codec is a real defect this format has had: every save dropped it, on every
//    device, silently. Setting it and then reading it back is the only assertion that could fail
//    for that.
//
// ⛔ AND "ALREADY THAT" MUST NOT WRITE. A no-op costs a version bump every other device on the
//    account then has to download.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { padding } from "../src/commands/padding.ts";
import { collect, entry, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

const WHAT_IT_HIDES =
  "Anyone can read the size of a piece stored on the storage network; the blank bytes make it one " +
  "of a set of fixed values instead of the exact number.";

test("an account that has never chosen is on the standard rule, and is told what padding hides", async () => {
  await withSandbox(drive, "padding-read", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await padding(undefined, opts(out)), 0);
    assert.deepEqual(out.lines, [
      "File sizes are hidden the standard way: a stored size shows as one of a few fixed values per doubling.",
      WHAT_IT_HIDES,
    ]);
  });
});

test("choosing powers of two writes it into the sealed list, and it reads back from there", async () => {
  await withSandbox(drive, "padding-set", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const set = collect();
    assert.equal(await padding("pow2", opts(set)), 0);
    assert.deepEqual(set.lines, [
      "Set to powers of two. It applies to what is uploaded next, from every device; files " +
        "already uploaded keep the size they were stored at.",
    ]);
    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);

    // ⛔ Read back through the blob the tool actually sent. A setting the codec dropped would
    //    round-trip as the default here and nowhere else.
    const read = collect();
    assert.equal(await padding(undefined, opts(read)), 0);
    assert.deepEqual(read.lines, [
      "File sizes are hidden with powers of two: a stored size shows as one value per doubling.",
      WHAT_IT_HIDES,
    ]);
  });
});

test("choosing the rule that is already in force writes nothing and says so", async () => {
  await withSandbox(drive, "padding-again", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await padding("standard", opts(out)), 0);
    assert.deepEqual(out.lines, ["Already standard. Nothing changed."]);
    assert.equal(drive.written.length, 0, "it rewrote the list for a setting that was already set");

    await padding("pow2", opts(collect()));
    const twice = collect();
    assert.equal(await padding("pow2", opts(twice)), 0);
    assert.deepEqual(twice.lines, ["Already powers of two. Nothing changed."]);
    assert.equal(drive.written.length, 1, "the second run rewrote the list for nothing");
  });
});

test("going back to the standard rule takes the field away rather than writing the default", async () => {
  await withSandbox(drive, "padding-back", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    await padding("pow2", opts(collect()));
    const out = collect();
    assert.equal(await padding("standard", opts(out)), 0);
    assert.deepEqual(out.lines, [
      "Set to standard. It applies to what is uploaded next, from every device; files already " +
        "uploaded keep the size they were stored at.",
    ]);
    const read = collect();
    await padding(undefined, opts(read));
    assert.match(read.lines[0] ?? "", /the standard way/);
  });
});

test("--json names the rule, whether it was read or set", async () => {
  await withSandbox(drive, "padding-json", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const read = collect();
    assert.equal(await padding(undefined, { ...opts(read), json: true }), 0);
    assert.deepEqual(JSON.parse(read.lines.join("")), { padding: "standard" });

    const set = collect();
    assert.equal(await padding("pow2", { ...opts(set), json: true }), 0);
    assert.deepEqual(JSON.parse(set.lines.join("")), { padding: "pow2" });
  });
});

test("⛔ a rule this tool does not know is refused before anything is asked of the server", async () => {
  await withSandbox(drive, "padding-unknown", async () => {
    const failure = await padding("pow-2", opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
    assert.equal(failure.message, '`nmts padding` takes standard or pow2, not "pow-2".');
    assert.equal(failure.exitCode, 2);
    assert.deepEqual(drive.calls, [], `it asked the server: ${drive.calls.join(" · ")}`);
  });
});

test("an account with no file list cannot record the setting — refused, nothing written", async () => {
  await withSandbox(drive, "padding-absent", async () => {
    const out = collect();
    await assert.rejects(
      () => padding("pow2", opts(out)),
      (error: unknown) =>
        error instanceof NmtsError &&
        error.exitCode === 4 &&
        /has no file list yet/.test(error.message) &&
        /Upload once/.test(error.nextStep ?? ""),
    );
    const read = collect();
    await padding(undefined, { ...opts(read), json: true });
    assert.equal(read.lines.join(""), JSON.stringify({ padding: "standard" }));
  });
});
