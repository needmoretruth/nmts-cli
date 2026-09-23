// `nmts ai-account list|create|delete` against a real local server.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. The command hands out a credential and can erase an account,
//    and it does both while proving the NMTS key rather than carrying an API key. So: the proof
//    travels and no bearer does, the new account's key is the one this account's key DERIVES (not a
//    fresh random one, which would be an account nobody could ever derive again), and the erasure
//    stops on anything but the typed sentence.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { create, list, remove } from "../src/commands/ai-account.ts";
import { DERIVED, loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import { aiAccountsState } from "./fake-ai-accounts.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({ server: drive.base, write: out.write });

/** The NMTS key this account's key derives for one place — the answer the tool must agree with. */
async function derivedCode(code: string, place: number): Promise<string> {
  const glue = await loadCrypto();
  const derived = glue.kdf_derive(glue.account_code_parse(code));
  const [from, to] = DERIVED.aiAccountRoot;
  try {
    return glue.derive_ai_account_code(derived.subarray(from, to), place);
  } finally {
    derived.fill(0);
  }
}

test("list proves the NMTS key, carries no API key, and prints one line per account", async () => {
  await withSandbox(drive, "ai-list", async () => {
    aiAccountsState.children = [
      { account_id: "childOne", child_index: 1, public_code: null, created_at: "2026-09-18T10:00:00Z", status: "active" },
      { account_id: "childTwo", child_index: 3, public_code: "pub", created_at: "2026-09-19T10:00:00Z", status: "stopped" },
    ];
    const out = collect();
    assert.equal(await list(opts(out)), 0);
    const asked = aiAccountsState.requests;
    assert.equal(asked.length, 1);
    assert.equal(asked[0]?.door, "list-by-code");
    assert.equal(asked[0]?.bearer, null, "an API key travelled to a door that refuses one");
    const text = out.lines.join("\n");
    assert.match(text, /place 1 {2}childOne {2}active {2}made 2026-09-18/);
    assert.match(text, /place 3 {2}childTwo {2}stopped {2}made 2026-09-19/);
  });
});

test("⛔ create derives the new key from this account's key and the place, and prints it once", async () => {
  await withSandbox(drive, "ai-create", async (code) => {
    // Place 1 is taken, so the lowest free one is 2.
    aiAccountsState.children = [
      { account_id: "childOne", child_index: 1, public_code: null, created_at: "2026-09-18T10:00:00Z", status: "active" },
    ];
    const out = collect();
    assert.equal(await create(undefined, opts(out)), 0);
    const made = aiAccountsState.requests.find((r) => r.door === "by-code");
    assert.ok(made !== undefined, "nothing was posted to the create door");
    assert.equal(made.bearer, null, "an API key travelled to a door that refuses one");
    const body = made.body;
    assert.ok(typeof body === "object" && body !== null);
    const at = (name: string): unknown => Reflect.get(body, name);
    assert.equal(at("child_index"), 2, "it did not take the lowest free place");

    // ⛔ THE KEY IS THE DERIVED ONE. A fresh random key would work today and be unrecoverable the
    //    day somebody lost it — the whole reason the server keeps the place is that this is derived.
    const expected = await derivedCode(code, 2);
    const printed = out.lines.map((line) => line.trim()).find((line) => line === expected);
    assert.ok(printed !== undefined, "the printed key is not the one this account's key derives");
    assert.equal(at("child_account_id"), (await identityOf(expected)).accountId);
    // ⛔ AND THE KEY ITSELF NEVER TRAVELS. Only the pair a sign-in sends does.
    assert.equal(JSON.stringify(body).includes(expected), false, "the new account's key was sent to the server");
    assert.match(out.lines.join("\n"), /THIS IS ITS NMTS KEY/);
  });
});

test("the first one under an account is refused with the one thing a terminal cannot do", async () => {
  await withSandbox(drive, "ai-need-enable", async () => {
    aiAccountsState.refuseCreateWith = "AI_ACCOUNTS_NEED_ENABLE";
    await assert.rejects(
      () => create(undefined, opts(collect())),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.match(error.message, /first AI account under this account is made in a browser/);
        assert.match(error.nextStep ?? "", /human check/);
        return true;
      },
    );
  });
});

test("⛔ anything but the typed sentence erases nothing", async () => {
  await withSandbox(drive, "ai-delete", async () => {
    const child = { account_id: "childOne", child_index: 1, public_code: null, created_at: "2026-09-18T10:00:00Z", status: "active" };
    aiAccountsState.children = [{ ...child }];
    assert.equal(await remove("childOne", { ...opts(collect()), readLine: async () => "yes" }), 1);
    assert.deepEqual(aiAccountsState.requests.filter((r) => r.door === "erase-by-code"), []);
    assert.equal(aiAccountsState.children.length, 1, "it erased one anyway");

    const out = collect();
    assert.equal(
      await remove("childOne", { ...opts(out), readLine: async () => "I UNDERSTAND THIS IS PERMANENT" }),
      0,
    );
    assert.deepEqual(aiAccountsState.children, []);
    assert.match(out.lines.join("\n"), /Erased\. The server holds nothing about that account now\./);
  });
});
