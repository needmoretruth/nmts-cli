// `nmts key list` and `nmts key revoke` against the fake account doors — what the tool sends, what
// it shows, and that the tier gate stands in front of a cut.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { accountProof } from "../src/account-proof.ts";
import { parseArgs } from "../src/args.ts";
import { setMode } from "../src/autonomy.ts";
import { keyList, keyRevoke } from "../src/commands/key-manage.ts";
import { key } from "../src/commands/key.ts";
import { writeCredentials } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { accountState, type FakeKey } from "./fake-account.ts";

const drive = await startFakeDrive();
after(() => drive.close());

function aKey(over: Partial<FakeKey> & Pick<FakeKey, "key_id">): FakeKey {
  return {
    scopes: 1,
    created_at: "2026-09-01T10:00:00Z",
    expires_at: "2026-10-01T10:00:00Z",
    last_used_at: null,
    revoked_at: null,
    uses: 0,
    ...over,
  };
}

test("list names and proves the account, and never sends the account code", async () => {
  await withSandbox(drive, "key-list-sends", async (code) => {
    accountState.keys = [aKey({ key_id: "k1" })];
    const out = collect();
    assert.equal(await keyList({ server: drive.base, write: out.write }), 0);
    assert.equal(accountState.listRequests.length, 1);
    const body = accountState.listRequests[0] as Record<string, unknown>;
    assert.equal(body["account_id"], (await identityOf(code)).accountId);
    assert.equal(body["auth_secret"], await accountProof(code));
    assert.ok(!JSON.stringify(body).includes(code.replace(/[\s-]/gu, "")), "the account code was sent");
  });
});

test("list shows each key's permissions, dates and use count, and marks this machine's", async () => {
  await withSandbox(drive, "key-list-screen", async (code) => {
    writeCredentials({ accountCode: code, server: drive.base, network: "testnet", apiKey: "nmts_ak1_k1_secret" });
    accountState.keys = [
      aKey({ key_id: "k1", scopes: 7, last_used_at: "2026-09-05T08:00:00Z", uses: 12 }),
      aKey({ key_id: "k2", revoked_at: "2026-09-03T00:00:00Z" }),
    ];
    const out = collect();
    assert.equal(await keyList({ server: drive.base, write: out.write }), 0);
    const screen = out.lines.join("\n");
    assert.match(screen, /k1 {2}← this machine/);
    assert.match(screen, /may {9}read, write, spend/);
    assert.match(screen, /last used {3}2026-09-05T08:00:00Z {2}\(12 uses\)/);
    assert.match(screen, /revoked {5}2026-09-03T00:00:00Z/);
    assert.match(screen, /1 live of 2/);
    assert.ok(!screen.includes("secret"), "the key string was printed");
  });
});

test("revoke <id> asks once at the terminal, then sends the id with the proof", async () => {
  await withSandbox(drive, "key-revoke-one", async (code) => {
    setMode("default");
    accountState.keys = [aKey({ key_id: "k1" }), aKey({ key_id: "k2" })];
    const out = collect();
    const asked: string[] = [];
    const readLine = async (q: string): Promise<string> => {
      asked.push(q);
      return "y";
    };
    assert.equal(await keyRevoke("k2", parseArgs(["key", "revoke", "k2"]), { server: drive.base, write: out.write, readLine }), 0);
    assert.equal(asked.length, 1, "the gate did not ask exactly once");
    const body = accountState.revokeRequests[0] as Record<string, unknown>;
    assert.equal(body["key_id"], "k2");
    assert.equal(body["auth_secret"], await accountProof(code));
    assert.match(out.lines.join("\n"), /Revoked key k2\./);
    assert.equal(accountState.keys.filter((k) => k.revoked_at === null).length, 1);
  });
});

test("a no at the gate sends nothing", async () => {
  await withSandbox(drive, "key-revoke-no", async () => {
    setMode("default");
    accountState.keys = [aKey({ key_id: "k1" })];
    await assert.rejects(
      keyRevoke("k1", parseArgs(["key", "revoke", "k1"]), { server: drive.base, write: () => {}, readLine: async () => "n" }),
      (e: unknown) => e instanceof NmtsError && e.exitCode === 1,
    );
    assert.equal(accountState.revokeRequests.length, 0, "a cut was sent after a no");
  });
});

test("revoke all cuts every live key and says how many", async () => {
  await withSandbox(drive, "key-revoke-all", async () => {
    setMode("default");
    accountState.keys = [aKey({ key_id: "k1" }), aKey({ key_id: "k2" }), aKey({ key_id: "k3", revoked_at: "2026-09-01T00:00:00Z" })];
    const out = collect();
    assert.equal(await keyRevoke("all", parseArgs(["key", "revoke", "all", "--yes"]), { server: drive.base, write: out.write }), 0);
    const body = accountState.revokeRequests[0] as Record<string, unknown>;
    assert.ok(!("key_id" in body), "revoking all still named a key");
    assert.match(out.lines.join("\n"), /Revoked 2 keys\./);
  });
});

test("a key the server does not know is refused with the way to see the real ids", async () => {
  await withSandbox(drive, "key-revoke-404", async () => {
    setMode("default");
    accountState.keys = [aKey({ key_id: "k1" })];
    await assert.rejects(
      keyRevoke("zz", parseArgs(["key", "revoke", "zz", "--yes"]), { server: drive.base, write: () => {} }),
      (e: unknown) => e instanceof NmtsError && /No live key zz/.test(e.message) && /key list/.test(e.nextStep ?? ""),
    );
  });
});

test("`key` with an unknown verb names all three", async () => {
  await withSandbox(drive, "key-verbs", async () => {
    await assert.rejects(
      key("delete", parseArgs(["key", "delete"])),
      (e: unknown) => e instanceof NmtsError && e.exitCode === 2 && /key list/.test(e.nextStep ?? "") && /key revoke/.test(e.nextStep ?? ""),
    );
  });
});
