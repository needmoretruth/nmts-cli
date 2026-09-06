// The record this tool keeps of what it did.
//
// ⛔ THE TEST THAT MATTERS MOST IS THE ONE WHERE WRITING FAILS. A full disk, a read-only home
//    directory and a config directory owned by somebody else are all ordinary, and none of them
//    is a reason for a command that worked to report a failure. That is a silent regression: the
//    log is a convenience nobody watches, so a throw from it would surface as `nmts get` failing
//    for a reason nobody could reproduce.
//
// ⛔ AND THE ONE WHERE IT GETS BIG. The cap is what keeps this file from being a thing somebody
//    has to clean up, and a trim that cut at a byte offset would leave half a JSON object at the
//    top of it for ever.

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { modesAreEnforced, testConfigDir } from "../src/credentials.ts";
import {
  forgetRun,
  MAX_LOG_BYTES,
  noteFailure,
  noteRequest,
  readRuns,
  recordRun,
  runLogPath,
  safeArgs,
} from "../src/run-log.ts";

/** A config directory of this test's own, put back afterwards. */
async function inSandbox(name: string, body: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = testConfigDir(`runlog-${name}`);
  const before = process.env["NMTS_CONFIG_DIR"];
  const noLog = process.env["NMTS_NO_RUN_LOG"];
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  delete process.env["NMTS_NO_RUN_LOG"];
  forgetRun();
  try {
    await body(dir);
  } finally {
    forgetRun();
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before;
    if (noLog === undefined) delete process.env["NMTS_NO_RUN_LOG"];
    else process.env["NMTS_NO_RUN_LOG"] = noLog;
  }
}

test("one run is one line: the command, its arguments, what came back and what failed", async () => {
  await inSandbox("one", () => {
    noteRequest("GET", "/v1/manifest", 200);
    noteRequest("GET", "/v1/items/abc", 404, "no such item");
    noteFailure("There is no photos/a.jpg in this account.");
    recordRun(["get", "photos/a.jpg", "--out", "-"], 4, 312, new Date("2026-09-04T10:00:00Z"));

    const runs = readRuns(10);
    assert.equal(runs.length, 1);
    const run = runs[0];
    assert.ok(run !== undefined);
    assert.equal(run.cmd, "get");
    assert.deepEqual(run.args, ["photos/a.jpg", "--out", "-"]);
    assert.equal(run.exit, 4);
    assert.equal(run.ms, 312);
    assert.equal(run.t, "2026-09-04T10:00:00.000Z");
    assert.deepEqual(run.events, [
      { kind: "http", method: "GET", path: "/v1/manifest", status: 200 },
      { kind: "http", method: "GET", path: "/v1/items/abc", status: 404, error: "no such item" },
      { kind: "error", message: "There is no photos/a.jpg in this account." },
    ]);
  });
});

test("⛔ what is written is redacted, in the arguments and in what the server said", async () => {
  await inSandbox("redacted", () => {
    const key = `nmts_ak1_Abcdefghijkl_${"x".repeat(43)}`;
    noteRequest("POST", `/v1/x?token=${key}`, 401, `the key ${key} was revoked`);
    recordRun(["login", "--message", "my private note", `--server=https://nmts.me`], 0, 5);

    const line = readFileSync(runLogPath(), "utf8");
    assert.ok(!line.includes(key), "the key reached the disk");
    assert.ok(!line.includes("my private note"), "a message value reached the disk");
    const run = readRuns(1)[0];
    assert.ok(run !== undefined);
    assert.deepEqual(run.args, ["--message", "[message]", "--server=https://nmts.me"]);
  });
});

test("the value of an option that must not be written goes in both spellings", () => {
  assert.deepEqual(safeArgs(["--message", "hello", "--omit", "drafts"]), [
    "--message",
    "[message]",
    "--omit",
    "[omitted]",
  ]);
  assert.deepEqual(safeArgs(["--message=hello"]), ["--message=[message]"]);
});

test("⛔ the no-run-log switch, when set, writes nothing at all", async () => {
  await inSandbox("off", () => {
    process.env["NMTS_NO_RUN_LOG"] = "1";
    noteRequest("GET", "/v1/manifest", 200);
    recordRun(["ls"], 0, 1);
    assert.equal(existsSync(runLogPath()), false, "a file was written with the log turned off");
    assert.deepEqual(readRuns(5), []);
  });
});

test("⛔ a log that cannot be written does not fail the command", async () => {
  const blocker = join(testConfigDir("runlog-blocked"), "notadir");
  const before = process.env["NMTS_CONFIG_DIR"];
  mkdirSync(testConfigDir("runlog-blocked"), { recursive: true });
  writeFileSync(blocker, "this is a file, not a directory");
  // The config directory is now a path THROUGH a regular file: every write below fails.
  process.env["NMTS_CONFIG_DIR"] = join(blocker, "cfg");
  try {
    forgetRun();
    noteFailure("something went wrong");
    // The whole assertion: this returns. The entry point calls it after the command has already
    // produced its exit code, so a throw here would turn a finished run into a failed one.
    recordRun(["ls"], 0, 1);
    assert.deepEqual(readRuns(5), []);
  } finally {
    rmSync(testConfigDir("runlog-blocked"), { recursive: true, force: true });
    if (before === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before;
  }
});

test("⛔ the file is capped, the oldest whole lines go, and no half line is left", async () => {
  await inSandbox("rotation", () => {
    // Each run carries about four kibibytes, so a hundred of them is well past the cap.
    const bulky = "x".repeat(4000);
    for (let i = 0; i < 100; i += 1) recordRun(["ls", `${i}`, bulky], 0, 1);

    const size = statSync(runLogPath()).size;
    assert.ok(size <= MAX_LOG_BYTES, `the log grew to ${size} bytes, past ${MAX_LOG_BYTES}`);
    const text = readFileSync(runLogPath(), "utf8");
    for (const line of text.split("\n")) {
      if (line === "") continue;
      // Every surviving line is a whole JSON object. A byte-offset cut would fail here.
      JSON.parse(line);
    }
    const runs = readRuns(1000);
    assert.ok(runs.length > 1, "the trim left one line — it is dropping too much");
    assert.ok(runs.length < 100, "nothing was dropped — the cap did not act");
    // The NEWEST run survives: that is the one a report is about.
    assert.deepEqual(runs.at(-1)?.args[0], "99");
  });
});

test("readRuns hands back the newest, oldest first", async () => {
  await inSandbox("newest", () => {
    for (const n of ["a", "b", "c", "d"]) recordRun(["ls", n], 0, 1);
    assert.deepEqual(
      readRuns(2).map((r) => r.args[0]),
      ["c", "d"],
    );
  });
});

test("the file is created 0600 where the platform honours it", async (t) => {
  if (!modesAreEnforced()) return t.skip("this platform applies no POSIX mode");
  await inSandbox("mode", () => {
    recordRun(["ls"], 0, 1);
    assert.equal(statSync(runLogPath()).mode & 0o777, 0o600);
  });
});

test("a line this version cannot read is dropped, not half-read", async () => {
  await inSandbox("garbage", () => {
    recordRun(["ls", "good"], 0, 1);
    writeFileSync(runLogPath(), `${readFileSync(runLogPath(), "utf8")}not json at all\n{"t":1}\n`);
    const runs = readRuns(10);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]?.args, ["good"]);
  });
});
