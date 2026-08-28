// What this pins: the mode is off unless somebody said otherwise in a sentence nobody types by
// accident, and every run that uses it says so.
//
// ⛔ WHY IT MATTERS. This is the setting that decides whether an agent asks before spending money
//    or doing something that cannot be undone. A default that drifts on, a file that fails open,
//    or a banner that stops printing are all the same failure: somebody stops being asked and
//    nobody notices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announcement, currentMode, setAt, setMode, AUTONOMY_MODES, RISK_FLAG } from "../src/autonomy.ts";
import { mode } from "../src/commands/mode.ts";
import { assertModeWhereEnforced } from "./helpers.ts";

function inFreshDir<T>(run: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nmts-autonomy-"));
  const before = process.env["NMTS_CONFIG_DIR"];
  process.env["NMTS_CONFIG_DIR"] = dir;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before;
  }
}

test("nothing is on until somebody turns it on", () => {
  inFreshDir(() => {
    assert.equal(currentMode(), "off");
    assert.equal(setAt(), null);
    assert.equal(announcement("off"), null, "off must not print a banner every run");
  });
});

test("⛔ turning one on takes the flag; turning one off never does", () => {
  inFreshDir(() => {
    const said: string[] = [];
    // Without the flag it explains and refuses — exit 2, the command-line-was-wrong code.
    assert.throws(() => mode("auto", { write: (l) => said.push(l) }), /decides whether you asked/);
    assert.equal(currentMode(), "off", "it turned on without the flag");

    assert.equal(mode("auto", { accepted: true, write: (l) => said.push(l) }), 0);
    assert.equal(currentMode(), "auto");

    // Off is the safe direction, so it must not be harder than on.
    assert.equal(mode("off", { write: (l) => said.push(l) }), 0);
    assert.equal(currentMode(), "off");
  });
});

test("⛔ every run says so while it is on, and names the way out", () => {
  for (const on of AUTONOMY_MODES.filter((m) => m !== "off")) {
    const line = announcement(on);
    assert.ok(line, on);
    assert.match(line, /^nmts: autonomy is /);
    assert.ok(line.includes(on), "the banner does not say WHICH mode is on");
    assert.match(line, /mode off/, "the banner does not say how to stop it");
  }
});

test("what is written down is dated, and readable only by its owner", () => {
  inFreshDir(() => {
    setMode("skip-permissions", "9.9.9", new Date("2026-08-28T05:00:00Z"));
    assert.equal(currentMode(), "skip-permissions");
    assert.equal(setAt(), "2026-08-28T05:00:00.000Z");
    const dir = process.env["NMTS_CONFIG_DIR"];
    assert.ok(dir);
    assertModeWhereEnforced(join(dir, "autonomy.json"), 0o600, "autonomy.json");
    assert.ok(statSync(join(dir, "autonomy.json")).isFile());
  });
});

test("⛔ a file it cannot understand counts as OFF — it never fails open", () => {
  inFreshDir(() => {
    const dir = process.env["NMTS_CONFIG_DIR"];
    assert.ok(dir);
    for (const junk of ["", "not json", "[]", '{"mode":"whatever"}', '{"mode":123}', "null"]) {
      writeFileSync(join(dir, "autonomy.json"), junk);
      assert.equal(currentMode(), "off", junk);
    }
  });
});

test("a name that is not a mode is a command-line error, not a silent no-op", () => {
  inFreshDir(() => {
    assert.throws(() => mode("yolo", { accepted: true }), /no mode called "yolo"/);
    assert.equal(currentMode(), "off");
  });
});

test("the flag is spelled out — a short one would be typed by accident", () => {
  assert.equal(RISK_FLAG, "--i-accept-the-risk");
  assert.ok(RISK_FLAG.length > 8);
});
