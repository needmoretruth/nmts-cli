// `nmts key new` against a real local server: what it sends, what it stores, and what it prints.
//
// ⛔ THE FIRST TEST IS THE ONE THAT MATTERS MOST. What travels is the DERIVED PROOF — the same
//    value a sign-in sends — and never the NMTS key, which opens every file in the account.
//    A regression there would not fail anything else: the server would answer, the key would work,
//    and the one promise this product is built on would be gone.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { accountProof } from "../src/account-proof.ts";
import { parseArgs } from "../src/args.ts";
import { credentialsPath, writeCredentials } from "../src/credentials.ts";
import { key, keyNew, scopeMask } from "../src/commands/key.ts";
import { NmtsError } from "../src/errors.ts";
import { ServerError } from "../src/api.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { accountState } from "./fake-account.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** Put a credentials file in the sandbox, so there is somewhere for a key to be stored. */
function storedHere(code: string): void {
  writeCredentials({ accountCode: code, server: drive.base, network: "testnet" });
}

test("it sends the derived proof and the account id — and never the NMTS key", async () => {
  await withSandbox(drive, "key-new-sends", async (code) => {
    const out = collect();
    assert.equal(await keyNew({ server: drive.base, write: out.write }), 0);

    assert.equal(accountState.issueRequests.length, 1, "the mint door was not called once");
    const sent = accountState.issueRequests[0];
    assert.ok(sent !== null && typeof sent === "object");
    const body = sent as Record<string, unknown>;
    const identity = await identityOf(code);
    assert.equal(body["account_id"], identity.accountId, "the account was named wrongly");
    assert.equal(body["auth_secret"], await accountProof(code), "the proof is not the sign-in one");
    // ⛔ The code itself, in any spelling, must not be anywhere in what left this machine.
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(code), "the NMTS key was sent to the server");
    assert.ok(!raw.includes(code.replace(/[\s-]/gu, "")), "the NMTS key was sent, ungrouped");
  });
});

test("the defaults are read-only and thirty days, and --scopes/--days change them", async () => {
  await withSandbox(drive, "key-new-defaults", async () => {
    await keyNew({ server: drive.base, write: collect().write });
    const first = accountState.issueRequests[0] as Record<string, unknown>;
    assert.equal(first["scopes"], 1, "the default is not read-only");
    assert.equal(first["lifetime_days"], 30, "the default lifetime moved");

    await keyNew({ server: drive.base, scopes: "read,write,spend", days: "7", write: collect().write });
    const second = accountState.issueRequests[1] as Record<string, unknown>;
    assert.equal(second["scopes"], 7, "the three permissions did not add up");
    assert.equal(second["lifetime_days"], 7);
  });
});

test("a permission this version does not know is refused before anything is sent", async () => {
  await withSandbox(drive, "key-new-bad-scope", async () => {
    await assert.rejects(
      () => keyNew({ server: drive.base, scopes: "read,delete", write: collect().write }),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 2);
        assert.match(error.message, /delete/);
        assert.match(error.nextStep ?? "", /read \(see what is stored\)/);
        return true;
      },
    );
    assert.equal(accountState.issueRequests.length, 0, "a bad permission still reached the server");
  });
});

test("the key is stored on this machine and NOT printed", async () => {
  await withSandbox(drive, "key-new-stores", async (code) => {
    storedHere(code);
    const out = collect();
    assert.equal(await keyNew({ server: drive.base, write: out.write }), 0);

    const written: unknown = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    assert.ok(written !== null && typeof written === "object");
    assert.equal((written as Record<string, unknown>)["apiKey"], accountState.issue.key);
    // ⛔ The secret half is nowhere on the screen. It was stored; showing it as well would put a
    //    credential in this terminal's scrollback for no reason anybody asked for.
    const screen = out.lines.join("\n");
    assert.ok(!screen.includes(accountState.issue.key), "the key was printed without --print");
    assert.match(screen, /Key KKKKKKKKKKKK made for/);
    assert.match(screen, /may {7}read/);
  });
});

test("--print puts the key on the screen once, alone on its own line", async () => {
  await withSandbox(drive, "key-new-print", async (code) => {
    storedHere(code);
    const out = collect();
    assert.equal(await keyNew({ server: drive.base, print: true, write: out.write }), 0);
    const alone = out.lines.filter((line) => line === accountState.issue.key);
    assert.equal(alone.length, 1, "the key is not on exactly one line of its own");
    assert.match(out.lines.join("\n"), /NMTS keeps no copy/);
  });
});

test("with no credentials file it stores nothing, says so, and prints the key anyway", async () => {
  await withSandbox(drive, "key-new-nowhere", async () => {
    const out = collect();
    assert.equal(await keyNew({ server: drive.base, write: out.write }), 0);
    const screen = out.lines.join("\n");
    assert.match(screen, /NOTHING WAS STORED/);
    // ⛔ It is printed even without --print, because this is the only moment it exists outside the
    //    server's memory and there is nowhere on this machine to put it.
    assert.ok(out.lines.includes(accountState.issue.key), "the key was lost rather than shown");
  });
});

test("--json carries the key only when --print was given as well", async () => {
  await withSandbox(drive, "key-new-json", async (code) => {
    storedHere(code);
    const quiet = collect();
    await keyNew({ server: drive.base, json: true, write: quiet.write });
    const first: unknown = JSON.parse(quiet.lines.join(""));
    assert.ok(first !== null && typeof first === "object");
    const quietRow = first as Record<string, unknown>;
    assert.equal(quietRow["key_id"], accountState.issue.key_id);
    assert.deepEqual(quietRow["scopes"], ["read"]);
    assert.equal(quietRow["stored"], true);
    assert.ok(!("key" in quietRow), "the key string went into a machine-readable answer");

    const loud = collect();
    await keyNew({ server: drive.base, json: true, print: true, write: loud.write });
    const second = JSON.parse(loud.lines.join("")) as Record<string, unknown>;
    assert.equal(second["key"], accountState.issue.key);
  });
});

test("the server's two refusals arrive with advice a caller can act on", async () => {
  await withSandbox(drive, "key-new-refusals", async () => {
    for (const [code, expected] of [
      ["API_KEY_CAP", /revoke a key they no longer use/],
      ["API_KEY_CHANNEL", /leave the preview/],
    ] as const) {
      accountState.refuseIssueWith = code;
      await assert.rejects(
        () => keyNew({ server: drive.base, write: collect().write }),
        (error: unknown) => {
          assert.ok(error instanceof ServerError, `${code} did not arrive as a named refusal`);
          assert.equal(error.code, code);
          assert.match(error.nextStep ?? "", expected);
          return true;
        },
      );
    }
    accountState.refuseIssueWith = null;
  });
});

test("`key` with no verb, or a verb it does not have, names the three that exist", async () => {
  // ⚠ Driven through the real parser rather than a hand-built options object: the dispatcher's
  //   whole job is reading the operand `main.ts` hands it, and a fabricated shape would not test
  //   that the operand is where this thinks it is.
  for (const typed of [["key"], ["key", "make"]]) {
    const args = parseArgs(typed);
    await assert.rejects(
      () => key(args.operands[0], args),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 2);
        assert.match(error.nextStep ?? "", /nmts key new/);
        assert.match(error.nextStep ?? "", /nmts key list/);
        assert.match(error.nextStep ?? "", /nmts key revoke/);
        return true;
      },
    );
  }
});

test("the three permission names map to the bits the server defines", () => {
  assert.equal(scopeMask("read"), 1);
  assert.equal(scopeMask("write"), 2);
  assert.equal(scopeMask("spend"), 4);
  assert.equal(scopeMask(" READ , Spend "), 5, "the names are not read case- and space-insensitively");
});
