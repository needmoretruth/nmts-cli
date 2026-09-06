// `nmts erase` — the permanent erase from a terminal: the sentence, the proof beside the key,
// the server first and the list last, and the storage release that never blocks the erase.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { setMode } from "../src/autonomy.ts";
import { CONFIRM_SENTENCE } from "../src/commands/delete-account.ts";
import { erase } from "../src/commands/erase.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { eraseState } from "./fake-erase.ts";

const drive = await startFakeDrive();
after(() => drive.close());

function answering(line: string): { asked: string[]; readLine: (q: string) => Promise<string> } {
  const asked: string[] = [];
  return { asked, readLine: async (q) => (asked.push(q), line) };
}

const opts = (out: { write: (line: string) => void }, readLine: (q: string) => Promise<string>) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
  readLine,
});

test("the typed sentence erases the rows with the proof beside the key, then drops the entries", async () => {
  await withSandbox(drive, "erase-typed", async (code) => {
    await drive.serve(code, [
      folder({ id: "d", name: "docs" }),
      entry({ id: "a", name: "a.txt", parentId: "d" }),
      entry({ id: "b", name: "b.txt" }),
    ]);
    drive.objects = ["a", "b"];
    const out = collect();
    const input = answering(CONFIRM_SENTENCE);
    assert.equal(await erase(["docs"], opts(out, input.readLine)), 0);
    assert.equal(input.asked.length, 1);
    assert.deepEqual(eraseState.erasures.map((e) => e.ids), [["a"]]);
    assert.ok(eraseState.erasures[0]?.proof, "the proof did not travel with the erase");
    assert.deepEqual(eraseState.releases, [], "storage was released without --release-storage");
    const left = await drive.lastWritten(code);
    assert.deepEqual(left.map((e) => e.id).sort(), ["b"], "the folder and its file did not leave the list");
    assert.match(out.lines.join("\n"), /Erased 1 file\./);
  });
});

test("anything but the sentence erases nothing and touches no row", async () => {
  await withSandbox(drive, "erase-no", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    drive.objects = ["a"];
    const input = answering("yes");
    assert.equal(await erase(["a.txt"], opts(collect(), input.readLine)), 1);
    assert.deepEqual(eraseState.erasures, []);
    assert.deepEqual(drive.written, [], "the list was written for a refused erase");
  });
});

test("--release-storage destroys credit-paid storage first, and a wallet-paid file is erased anyway with a note", async () => {
  await withSandbox(drive, "erase-release", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" }), entry({ id: "w", name: "w.txt" })]);
    drive.objects = ["a", "w"];
    eraseState.walletPaid = ["w"];
    const out = collect();
    const input = answering(CONFIRM_SENTENCE);
    assert.equal(await erase(["a.txt", "w.txt"], { ...opts(out, input.readLine), releaseStorage: true }), 0);
    assert.deepEqual(eraseState.releases.map((r) => r.id), ["a", "w"]);
    assert.ok(eraseState.releases.every((r) => r.proof), "a release went without the proof");
    const order = drive.calls.filter((c) => c.includes("release-storage") || c.endsWith("/v1/items/erase"));
    assert.equal(order.at(-1), "POST /v1/items/erase", "the erase did not come after the releases");
    assert.deepEqual(eraseState.erasures.map((e) => e.ids), [["a", "w"]]);
    const text = out.lines.join("\n");
    assert.match(text, /a\.txt: storage released/);
    assert.match(text, /w\.txt: storage not released/);
  });
});

test("under skip-permissions the gate's --yes stands for the sentence; elsewhere --yes alone does not", async () => {
  await withSandbox(drive, "erase-skip", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    drive.objects = ["a"];
    const input = answering("no");
    assert.equal(await erase(["a.txt"], { ...opts(collect(), input.readLine), yes: true }), 1, "--yes stood for the sentence in the default mode");
    assert.equal(input.asked.length, 1);
    setMode("skip-permissions", "9.9.9", new Date("2026-09-06T00:00:00Z"));
    try {
      const quiet = answering("no");
      assert.equal(await erase(["a.txt"], { ...opts(collect(), quiet.readLine), yes: true }), 0);
      assert.equal(quiet.asked.length, 0, "the sentence was asked for under skip-permissions");
      assert.equal(eraseState.erasures.length, 1);
    } finally {
      setMode("default", "9.9.9", new Date("2026-09-06T00:00:00Z"));
    }
  });
});

test("a path that names nothing refuses the whole run before any row is touched", async () => {
  await withSandbox(drive, "erase-missing", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const failure = await erase(["a.txt", "nope.txt"], opts(collect(), answering(CONFIRM_SENTENCE).readLine)).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.deepEqual(eraseState.erasures, []);
  });
});
