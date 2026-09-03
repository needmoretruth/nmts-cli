// `nmts whoami --reveal` — the one command that puts the account code on the screen.
//
// ⛔ THE REFUSAL IS THE TEST THAT MATTERS. Every other value this command prints is public; the
//    code is the account. A mode says an agent may decide for the person, and no setting can say
//    on their behalf that the key to everything should be printed into a transcript — so the
//    refusal has to come before the code is even opened, and a regression there is silent.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { setMode } from "../src/autonomy.ts";
import { NmtsError } from "../src/errors.ts";
import { whoami } from "../src/commands/whoami.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const WARNING =
  "The account code is the account: anyone who reads it can open every file and delete the account.";

test("it prints what the code is, and then the code alone on its own line", async () => {
  await withSandbox(drive, "reveal-prints", async (code) => {
    const out = collect();
    assert.equal(await whoami({ reveal: true, write: out.write }), 0);
    assert.deepEqual(out.lines, [WARNING, (await identityOf(code)).displayCode]);
  });
});

test("--json hands over the code and nothing else", async () => {
  await withSandbox(drive, "reveal-json", async (code) => {
    const out = collect();
    assert.equal(await whoami({ reveal: true, json: true, write: out.write }), 0);
    assert.deepEqual(JSON.parse(out.lines.join("")), {
      account_code: (await identityOf(code)).displayCode,
    });
  });
});

test("⛔ a mode that lets an agent decide cannot put the code on the screen", async () => {
  await withSandbox(drive, "reveal-mode", async () => {
    setMode("auto", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    try {
      const out = collect();
      const failure = await whoami({ reveal: true, write: out.write }).then(
        () => null,
        (e: unknown) => e,
      );
      assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
      assert.equal(
        failure.message,
        "An agent does not need the code on screen — this tool already holds it.",
      );
      assert.equal(
        failure.nextStep,
        "A person runs `nmts whoami --reveal` outside mode auto and without --skip-permissions.",
      );
      assert.equal(failure.exitCode, 5);
      assert.deepEqual(out.lines, [], "it printed something on the way to refusing");
    } finally {
      setMode("off", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    }
  });
});

test("without --reveal it is the listing it has always been, and no code is in it", async () => {
  await withSandbox(drive, "reveal-absent", async (code) => {
    const out = collect();
    assert.equal(await whoami({ write: out.write }), 0);
    const printed = out.lines.join("\n");
    assert.match(printed, /Account id {3}/);
    assert.doesNotMatch(printed, new RegExp((await identityOf(code)).displayCode.slice(0, 12)));
  });
});
