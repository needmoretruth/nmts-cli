// `nmts whoami --reveal` — the one command that puts the NMTS key on the screen.
//
// ⛔ THE REFUSAL IS THE TEST THAT MATTERS. Every other value this command prints is public; the
//    code is the account. A mode says an agent may decide for the person, and no setting can say
//    on their behalf that the key to everything should be printed into a transcript — so the
//    refusal has to come before the code is even opened, and a regression there is silent.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { whoami } from "../src/commands/whoami.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const WARNING =
  "The NMTS key is the account: anyone who reads it can open every file and delete the account.";

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

test("without --reveal it is the listing it has always been, and no code is in it", async () => {
  await withSandbox(drive, "reveal-absent", async (code) => {
    const out = collect();
    assert.equal(await whoami({ write: out.write }), 0);
    const printed = out.lines.join("\n");
    assert.match(printed, /Account id {3}/);
    assert.doesNotMatch(printed, new RegExp((await identityOf(code)).displayCode.slice(0, 12)));
  });
});
