// The four modes: what is stored, what is read back, how one is switched, and what every run says.
//
// ⛔ THE ONE THAT MATTERS MOST: a mode is switched by a person at a terminal. Without one the
//    command refuses — that is the lock an agent's subprocess meets — and the safe direction never
//    needs a terminal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AUTONOMY_MODES,
  SKIP_SENTENCE,
  announcement,
  currentMode,
  explain,
  modeFromStored,
  setAt,
  setMode,
} from "../src/autonomy.ts";
import { mode } from "../src/commands/mode.ts";
import { NmtsError } from "../src/errors.ts";
import { assertModeWhereEnforced } from "./helpers.ts";

async function inFreshDir<T>(run: () => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "nmts-autonomy-"));
  const before = process.env["NMTS_CONFIG_DIR"];
  process.env["NMTS_CONFIG_DIR"] = dir;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before;
  }
}

const answering = (answer: string) => async (_q: string) => answer;

test("nothing is on until somebody turns it on", async () => {
  await inFreshDir(() => {
    assert.equal(currentMode(), "default");
    assert.equal(setAt(), null);
    assert.equal(announcement("default"), null, "default must not print a banner every run");
  });
});

test("⛔ turning a mode on needs a terminal; turning it off never does", async () => {
  await inFreshDir(async () => {
    const said: string[] = [];
    // No readLine and no TTY under the test runner: the lock an agent's subprocess meets.
    await assert.rejects(
      () => mode("auto-low", undefined, { write: (l) => said.push(l) }),
      (e: unknown) => {
        assert.ok(e instanceof NmtsError);
        assert.equal(e.exitCode, 5);
        assert.match(e.nextStep ?? "", /do not switch modes/);
        return true;
      },
    );
    assert.equal(currentMode(), "default", "it turned on without a terminal");

    // With a person answering, the explanation is printed first and y turns it on.
    assert.equal(await mode("auto-low", undefined, { write: (l) => said.push(l), readLine: answering("y") }), 0);
    assert.equal(currentMode(), "auto-low");
    assert.ok(said.some((l) => l.startsWith("auto-low — ")), "the explanation was not printed before the question");

    // Anything but y leaves it as it was.
    assert.equal(await mode("auto-high", undefined, { write: () => {}, readLine: answering("") }), 1);
    assert.equal(currentMode(), "auto-low");

    // Off is the safe direction: one line, no terminal.
    assert.equal(await mode("default", undefined, { write: (l) => said.push(l) }), 0);
    assert.equal(currentMode(), "default");
  });
});

test("⛔ skip-permissions takes the typed sentence, not a y", async () => {
  await inFreshDir(async () => {
    assert.equal(await mode("skip-permissions", undefined, { write: () => {}, readLine: answering("y") }), 1);
    assert.equal(currentMode(), "default", "a bare y turned skip-permissions on");
    assert.equal(await mode("skip-permissions", undefined, { write: () => {}, readLine: answering(SKIP_SENTENCE) }), 0);
    assert.equal(currentMode(), "skip-permissions");
  });
});

test("the two older spellings are still read, and still accepted at the command", async () => {
  await inFreshDir(async () => {
    assert.equal(modeFromStored("off"), "default");
    assert.equal(modeFromStored("auto"), "auto-low");
    const dir = process.env["NMTS_CONFIG_DIR"];
    assert.ok(dir);
    writeFileSync(join(dir, "autonomy.json"), JSON.stringify({ mode: "auto", setAt: "2026-09-01T00:00:00Z" }));
    assert.equal(currentMode(), "auto-low");
    assert.equal(await mode("off", undefined, { write: () => {} }), 0);
    assert.equal(currentMode(), "default");
  });
});

test("`mode explain` prints the whole explanation and changes nothing", async () => {
  await inFreshDir(async () => {
    const said: string[] = [];
    assert.equal(await mode("explain", "skip-permissions", { write: (l) => said.push(l) }), 0);
    assert.deepEqual(said, explain("skip-permissions"));
    assert.match(said.join("\n"), /--reason/);
    assert.match(said.join("\n"), /nmts mode default/);
    assert.equal(currentMode(), "default");
    for (const m of AUTONOMY_MODES) assert.ok(explain(m).length >= 5, `${m} is explained in fewer than five lines`);
  });
});

test("⛔ every run says so while it is on, and names the way out", () => {
  for (const on of AUTONOMY_MODES.filter((m) => m !== "default")) {
    const line = announcement(on);
    assert.ok(line, on);
    assert.match(line, /^nmts: autonomy is /);
    assert.ok(line.includes(on), "the banner does not say WHICH mode is on");
    assert.match(line, /mode default/, "the banner does not say how to stop it");
  }
});

test("what is written down is dated, and readable only by its owner", async () => {
  await inFreshDir(() => {
    setMode("skip-permissions", "9.9.9", new Date("2026-08-28T05:00:00Z"));
    assert.equal(currentMode(), "skip-permissions");
    assert.equal(setAt(), "2026-08-28T05:00:00.000Z");
    const dir = process.env["NMTS_CONFIG_DIR"];
    assert.ok(dir);
    assertModeWhereEnforced(join(dir, "autonomy.json"), 0o600, "autonomy.json");
    assert.ok(statSync(join(dir, "autonomy.json")).isFile());
  });
});

test("⛔ a file it cannot understand counts as DEFAULT — it never fails open", async () => {
  await inFreshDir(() => {
    const dir = process.env["NMTS_CONFIG_DIR"];
    assert.ok(dir);
    for (const junk of ["", "not json", "[]", '{"mode":"whatever"}', '{"mode":123}', "null"]) {
      writeFileSync(join(dir, "autonomy.json"), junk);
      assert.equal(currentMode(), "default", junk);
    }
  });
});

test("a name that is not a mode is a command-line error, not a silent no-op", async () => {
  await inFreshDir(async () => {
    await assert.rejects(() => mode("yolo", undefined, { readLine: answering("y") }), /no mode called "yolo"/);
    assert.equal(currentMode(), "default");
  });
});
