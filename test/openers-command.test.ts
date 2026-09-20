// The terminal over wallet sign-in: the three verbs, the options that carry a wallet, and the one
// case where a brand-new account has no credential to speak with.
//
// ⛔ THE COMMAND LAYER IS WHAT A PERSON TYPES, AND IT IS WIRING. What each act DOES is judged in
//    `openers.test.ts`, against real signatures; what is judged here is that `nmts openers add`
//    reaches it, that `--wallet` still means a wallet NUMBER where it always did, and that a key
//    borrowed to attach an opener to a fresh account is cut again afterwards.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { parseArgs } from "../src/args.ts";
import { openers, walletOpenerFrom } from "../src/commands/openers.ts";
import { attachWalletToNewAccount } from "../src/commands/openers-attach.ts";
import { NmtsError } from "../src/errors.ts";
import { walletFromKeyFile } from "../src/openers-key-file.ts";
import { actOf } from "../src/risk.ts";
import { accountState } from "./fake-account.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { openerState, testWallet, walletSeed } from "./fake-openers.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** The command line a test types, as `main.ts` would hand it over. */
function args(...argv: string[]): ReturnType<typeof parseArgs> {
  return { ...parseArgs(argv), server: drive.base };
}

test("the three verbs attach a wallet, list it, and take it off", async () => {
  await withSandbox(drive, "openers-command", async () => {
    // ⛔ A SEEDED WALLET, so the locator this test TYPES is the same one every run. Seed 0 reaches
    //    a locator that starts with a letter; the seed below reaches one that starts with `-`, and
    //    that case has its own test because it is typed differently.
    const wallet = testWallet(walletSeed(0));
    const added = collect();
    assert.equal(await openers("add", args("openers", "add"), { write: added.write, wallet }), 0);
    const locator = openerState.slots.keys().next().value;
    assert.ok(typeof locator === "string" && locator.length > 0, "nothing was stored");
    assert.ok(added.lines.join("\n").includes(locator), "the locator was not printed");

    const listed = collect();
    assert.equal(await openers(undefined, args("openers"), { write: listed.write }), 0);
    const screen = listed.lines.join("\n");
    assert.match(screen, /1 of 8 openers/);
    assert.match(screen, /wallet/);

    const gone = collect();
    assert.equal(await openers("remove", args("openers", "remove", locator), { write: gone.write }), 0);
    assert.equal(openerState.slots.size, 0, "the opener stayed on the account");
    // ⛔ WHAT REMOVAL PROMISES AND WHAT IT DOES NOT, said where a person reads it.
    assert.match(gone.lines.join("\n"), /from now on/);
  });
});

test("a locator that begins with `-` is taken off after `--`, the way a file named `-h` is", async () => {
  // ⛔ ABOUT ONE LOCATOR IN 64 BEGINS WITH `-`, because it is 16 bytes written in base64url and
  //    that alphabet has a dash in it. Such a token is an option name to every shell and to this
  //    tool's parser, so the answer is the one this tool already gives for a file called `-h`:
  //    `--` ends the options. This test holds both halves of that — the refusal and the way past
  //    it — so neither can change without being seen.
  await withSandbox(drive, "openers-command-dash", async () => {
    const wallet = testWallet(walletSeed(50));
    const added = collect();
    assert.equal(await openers("add", args("openers", "add"), { write: added.write, wallet }), 0);
    const locator = openerState.slots.keys().next().value;
    assert.ok(typeof locator === "string" && locator.startsWith("-"), "the seed stopped naming a dashed locator");
    assert.ok(
      added.lines.join("\n").includes(`openers remove -- ${locator}`),
      "the line offered for copying would be refused if it were typed",
    );

    assert.throws(() => args("openers", "remove", locator), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      return true;
    });

    const gone = collect();
    assert.equal(await openers("remove", args("openers", "remove", "--", locator), { write: gone.write }), 0);
    assert.equal(openerState.slots.size, 0, "the opener stayed on the account");
  });
});

test("`openers remove` with nothing named refuses instead of guessing which one", async () => {
  await withSandbox(drive, "openers-command-name", async () => {
    await assert.rejects(openers("remove", args("openers", "remove")), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      return true;
    });
    assert.deepEqual(openerState.calls, [], "a refused command reached the server");
  });
});

test("`--wallet` carries a wallet number where it always did, and nothing on a sign-in", () => {
  // ⛔ THE OPTION MOVED TABLES ON 2026-09-20 and this is what must not have moved with it.
  assert.equal(parseArgs(["put", "a.pdf", "--pay", "wallet", "--wallet", "3"]).wallet, "3");
  assert.equal(parseArgs(["extend", "a.pdf", "--wallet=2"]).wallet, "2");
  // The bare form is how a sign-in says "the NMTS key comes from a wallet" — and the option that
  // follows it is read as an option rather than swallowed as this one's value.
  const login = parseArgs(["login", "--wallet", "--sui-key-file", "/k/wallet.key", "--account", "2"]);
  assert.equal(login.wallet, "");
  assert.equal(login.suiKeyFile, "/k/wallet.key");
  assert.equal(login.account, "2");
  assert.equal(parseArgs(["ls"]).wallet, undefined, "an absent option is not the bare one");
});

test("the acts are the ones the tier table names", () => {
  assert.equal(actOf(parseArgs(["openers"])), "openers");
  assert.equal(actOf(parseArgs(["openers", "add"])), "openers.add");
  assert.equal(actOf(parseArgs(["openers", "remove", "abc"])), "openers.remove");
});

test("the wallet is read from the file the command line names, and never from a value", () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-key-"));
  const keypair = new Ed25519Keypair();
  const path = join(dir, "wallet.key");
  writeFileSync(path, `${keypair.getSecretKey()}\n`, { mode: 0o600 });
  assert.equal(walletFromKeyFile(path).address, keypair.toSuiAddress());

  const wrong = join(dir, "notes.txt");
  writeFileSync(wrong, "this is not a key\n");
  assert.throws(() => walletFromKeyFile(wrong), (error: unknown) => {
    assert.ok(error instanceof NmtsError);
    // ⛔ THE FILE'S CONTENTS ARE NOT IN THE REFUSAL, whatever they were.
    assert.ok(!error.message.includes("this is not a key"));
    return true;
  });
  assert.throws(() => walletOpenerFrom(parseArgs(["openers", "add"])), /--sui-key-file/);
});

test("a wallet attached to a BRAND-NEW account borrows a key for one request and cuts it", async () => {
  await withSandbox(drive, "openers-attach-new", async (code) => {
    accountState.keys = [
      { key_id: accountState.issue.key_id, scopes: 2, created_at: "2026-09-20T00:00:00Z", expires_at: "2026-09-21T00:00:00Z", last_used_at: null, revoked_at: null, uses: 0 },
    ];
    const attached = await attachWalletToNewAccount({ server: drive.base, code, wallet: testWallet() });
    assert.equal(openerState.slots.size, 1, "the wallet was not attached");
    assert.equal(attached.keyLeft, null, "the borrowed key was left live");
    // ⛔ IT WAS THE BORROWED KEY THAT SPOKE, and the account code's own proof went with it.
    assert.equal(openerState.calls.at(-1)?.bearer, accountState.issue.key);
    assert.ok(openerState.calls.at(-1)?.proof, "the attach travelled without the account proof");
    assert.equal(accountState.keys[0]?.revoked_at !== null, true, "the borrowed key was not cut");
  });
});

test("a borrowed key that could NOT be cut is reported rather than left in silence", async () => {
  await withSandbox(drive, "openers-attach-left", async (code) => {
    // Nothing for the revoke door to find: the real server answers 404, and this run has to say so
    // rather than report a tidy attach.
    accountState.keys = [];
    const attached = await attachWalletToNewAccount({ server: drive.base, code, wallet: testWallet() });
    assert.equal(openerState.slots.size, 1, "the wallet was not attached");
    assert.equal(attached.keyLeft, accountState.issue.key_id, "a live key was not reported");
  });
});
