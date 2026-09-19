// The Node host sits the contract both hosts sit, and keeps the file names it promised.
//
// ⛔ THE CONTRACT IS `src/host-contract.ts`, AND THE SDK'S BROWSER TEST RUNS THE SAME FUNCTION.
//    Two tests written separately would drift, and the way that drift shows up is a half-finished
//    upload that resumes on a laptop and starts again in a browser.
//
// ⛔ THE FILE NAMES ARE THE OTHER HALF, and they are the half a person notices. A home directory
//    holding an unfinished upload and a kept file list was written by an earlier version of this
//    tool; a host that spelled the keys differently would leave every one of those unread, and
//    nothing would report it — the account would simply look like a machine that had never seen it.

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { modesAreEnforced, testConfigDir } from "../src/credentials.ts";
import { hostContract } from "../src/host-contract.ts";
import { nodeHost, statePath } from "../src/host-node.ts";

/** A config directory of this test's own, put back afterwards. */
async function inSandbox(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(`host-node-${name}`);
  const before = process.env["NMTS_CONFIG_DIR"];
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before;
  }
}

test("the Node host keeps state the way every caller in the package expects", async () => {
  await inSandbox("contract", async () => {
    assert.deepEqual(await hostContract(nodeHost()), []);
  });
});

/** Key on the left, the file an earlier version of this tool wrote on the right. */
const NAMES: readonly (readonly [string, string])[] = [
  ["runlog", "runs.jsonl"],
  ["collision", "collision.json"],
  ["autonomy", "autonomy.json"],
  ["manifest/state", "file-list-state.json"],
  ["manifest/abc123", "file-list-abc123.json"],
  ["chunks/abc123/deadbeef", join("file-list-chunks", "abc123", "deadbeef.ct")],
  ["uploads/k1.json", join("uploads", "k1.json")],
  ["uploads/k1.bin", join("uploads", "k1.bin")],
  ["uploads/k1.item.json", join("uploads", "k1.item.json")],
];

test("a state key lands on the file an older installation already has", async () => {
  await inSandbox("names", async (dir) => {
    const state = nodeHost().state;
    for (const [key, file] of NAMES) {
      assert.equal(statePath(key), join(dir, file), `${key} does not land on ${file}`);
      // Written where an older version would have written it, and read back through the key.
      const target = join(dir, file);
      mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(target, `${key}\n`, { mode: 0o600 });
      const held = await state.read(key);
      assert.equal(held === undefined ? null : new TextDecoder().decode(held), `${key}\n`);
    }
  });
});

test("what the host writes is private to this account, and lands whole or not at all", async () => {
  await inSandbox("modes", async (dir) => {
    const state = nodeHost().state;
    await state.write("uploads/k9.bin", new Uint8Array([1, 2, 3]));
    const path = join(dir, "uploads", "k9.bin");
    assert.ok(existsSync(path));
    if (modesAreEnforced()) assert.equal(statSync(path).mode & 0o777, 0o600);
    // ⛔ NOTHING IS LEFT BESIDE IT. The write goes to a scratch name and is renamed over; a scratch
    //    file left behind would hold the same sealed bytes under a name nothing ever cleans up.
    await state.write("uploads/k9.bin", new Uint8Array([4, 5, 6]));
    assert.deepEqual(await state.keys("uploads/"), ["uploads/k9.bin"]);
    assert.deepEqual([...readFileSync(path)], [4, 5, 6]);
  });
});

test("keys() answers in keys, not in file names, and only for what this tool wrote", async () => {
  await inSandbox("keys", async (dir) => {
    const state = nodeHost().state;
    await state.write("chunks/acc/one", new Uint8Array([1]));
    await state.write("chunks/acc/two", new Uint8Array([2]));
    await state.write("manifest/acc", new Uint8Array([3]));
    // A file this tool keeps outside the state — the credentials — must not appear as a key.
    writeFileSync(join(dir, "credentials.json"), "{}\n", { mode: 0o600 });
    assert.deepEqual((await state.keys("chunks/acc/")).sort(), ["chunks/acc/one", "chunks/acc/two"]);
    assert.deepEqual(await state.keys("manifest/"), ["manifest/acc"]);
    assert.deepEqual(await state.keys("credentials"), []);
  });
});

test("a browser is not the only thing that has no environment: the host is the one way in", () => {
  const host = nodeHost();
  assert.equal(host.name, "node");
  process.env["NMTS_HOST_TEST_VALUE"] = "here";
  try {
    assert.equal(host.env("NMTS_HOST_TEST_VALUE"), "here");
    assert.ok(host.envEntries().some((e) => e.name === "NMTS_HOST_TEST_VALUE" && e.value === "here"));
  } finally {
    delete process.env["NMTS_HOST_TEST_VALUE"];
  }
});
