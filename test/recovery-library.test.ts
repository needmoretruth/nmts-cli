// The recovery list as a library (`./recovery`, spec 2026-09-20 unit B).
//
// ⛔ THE COMMAND AND THE LIBRARY HAND OUT ONE FILE. With the clock and the engine's randomness held
//    still, `nmts recovery-list` and `makeRecoveryList` are run over the same account and their bytes
//    compared. A shell that re-assembled anything — a header field, a newline — fails here.
//
// ⛔ AND THE NUMBER IS THE HIGHER OF TWO. The server's narrow read and this machine's memory, plus
//    one; a server older than the read falls back to the memory alone.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { recoveryList } from "../src/commands/recovery-list.ts";
import { configDir } from "../src/credentials.ts";
import { makeRecoveryList, nextRecoverySeq, readRecoveryCopy, recordRecoveryList, setRecoveryCopy, type RecoveryAccount } from "../src/recovery.ts";
import { assertModeWhereEnforced } from "./helpers.ts";
import { KEY } from "./fake-drive.ts";
import { authSecretOf, startFakeRecovery, withAccount } from "./fake-recovery.ts";
import { serveThreeFiles, writeHeld, writtenBytes } from "./recovery-bytes-fixture.ts";

const fake = await startFakeRecovery();
after(() => fake.close());

async function accountOf(code: string): Promise<RecoveryAccount> {
  return {
    server: fake.base,
    bearer: KEY,
    code,
    accountId: (await identityOf(code)).accountId,
    network: "testnet",
    accountProof: await authSecretOf(code),
  };
}

test("the command writes exactly the bytes the library returns, under the same name", async () => {
  await withAccount(fake, "reclib-bytes", async (code) => {
    await serveThreeFiles(fake, code);
    const account = await accountOf(code);
    // The library first: it records nothing, so the command after it offers the same number.
    const made = await writeHeld(() => makeRecoveryList(account));
    const written = await writeHeld(() =>
      writtenBytes((out, write) => recoveryList({ server: fake.base, network: "testnet", out, write })),
    );
    assert.equal(made.seq, 1);
    assert.equal(written.name, made.file.filename);
    assert.deepEqual(written.bytes, made.file.content, "the command's file is not the library's file");
    assert.deepEqual(made.built.missingFromSource, []);
    assert.equal(made.built.fileCount, 3);
  });
});

test("the next number beats the server's and this machine's, whichever is higher", async () => {
  await withAccount(fake, "reclib-seq", async (code) => {
    await serveThreeFiles(fake, code);
    const account = await accountOf(code);
    fake.recordedSeq = 5;
    assert.equal(await nextRecoverySeq(account), 6, "a browser's list numbered 5 was not beaten");
    const made = await makeRecoveryList(account);
    assert.equal(made.seq, 6);
    await recordRecoveryList(account, { seq: made.seq, capturedAt: made.capturedAt });
    assert.equal(fake.recordedSeq, 6);

    // ⚠ A server older than the narrow read: the memory alone carries the number on.
    fake.narrowRead = false;
    assert.equal(await readRecoveryCopy(account), null);
    assert.equal(await nextRecoverySeq(account), 7);

    // ⛔ THE SAME FILE, THE SAME TEXT, 0600 — the host's state writes where `node:fs` used to.
    const counter = join(configDir(), `recovery-seq-${account.accountId}.json`);
    assert.equal(readFileSync(counter, "utf8"), `${JSON.stringify({ seq: 6 }, null, 2)}\n`);
    assertModeWhereEnforced(counter, 0o600, "the counter was not written 0600");
  });
});

test("the switch reads without the proof and flips with it", async () => {
  await withAccount(fake, "reclib-switch", async (code) => {
    await fake.serve(code, []);
    const account = await accountOf(code);
    assert.deepEqual(await readRecoveryCopy(account), { enabled: false, written: false, seq: 0 });
    await setRecoveryCopy(account, true);
    assert.deepEqual(await readRecoveryCopy(account), { enabled: true, written: false, seq: 0 });
    assert.equal(fake.proofs.at(-1), account.accountProof, "the switch was flipped without the code's proof");
    await recordRecoveryList(account, { seq: 1, blobId: "quilt-a" });
    assert.deepEqual(await readRecoveryCopy(account), { enabled: true, written: true, seq: 1 });
    await setRecoveryCopy(account, false);
    assert.equal((await readRecoveryCopy(account))?.enabled, false);
  });
});
