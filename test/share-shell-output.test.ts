// The share commands print what they printed before they became shells over `sharing.ts`.
//
// ⛔ WHY THIS EXISTS (spec 2026-09-20 unit C). `nmts share`, `shares`, `shares --sent`, `receive` and
//    `unshare` moved their work into the library an app calls, and a person reading the terminal or
//    a program reading `--json` must not see one byte change. Every line below is written out whole,
//    and the same file was run against the commands as they stood before the move: it passed there
//    too, so these are the old bytes and not whatever the new code happens to print.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { receive } from "../src/commands/receive.ts";
import { share, shares, unshare } from "../src/commands/share.ts";
import { sharesSent } from "../src/commands/shares-sent.ts";
import { testConfigDir } from "../src/credentials.ts";
import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import { sealShare, shareKeysOf } from "../src/share.ts";
import { shareKeysAt } from "../src/share-codes.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { bytesState } from "./fake-bytes.ts";
import { collect, entry, startFakeDrive, withSandbox, type FakeDrive } from "./fake-drive.ts";
import { publicCodesState as state } from "./fake-public-codes.ts";
import { generateCode, grantConsents, sealFile } from "./helpers.ts";

let drive: FakeDrive;
before(async () => {
  drive = await startFakeDrive();
  process.env[AGGREGATOR_ENV_VAR] = drive.base;
});
after(() => {
  delete process.env[AGGREGATOR_ENV_VAR];
  drive.close();
});

const REAL = new TextEncoder().encode("the bytes of one shared memo");
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const at = { server: "", network: "testnet" };

async function setUp(code: string): Promise<{ recipient: string; address: string }> {
  grantConsents(process.env["NMTS_CONFIG_DIR"] ?? "", "plain-env", "share");
  at.server = drive.base;
  const sealed = await sealFile(code, [REAL], REAL.length);
  await drive.serve(code, [entry({ id: "f1", name: "memo.txt", size: REAL.length, dekWrapped: sealed.dekWrapped, contentHashCt: sealed.contentHashCt })]);
  const r = shareKeysOf(await loadCrypto(), await generateCode());
  state.recipients.set(b64(r.address), b64(r.identity));
  const out = { recipient: r.display, address: b64(r.address) };
  r.wipe();
  return out;
}

test("share: the question without --yes, the first code, the text and the JSON answers", async () => {
  await withSandbox(drive, "shell-share", async (code) => {
    const { recipient } = await setUp(code);
    const asked = collect();
    assert.equal(await share("memo.txt", recipient, { ...at, write: asked.write }), 5);
    assert.equal(
      asked.lines.join("\n"),
      [
        `Would share "memo.txt" with ${recipient}.`,
        ``,
        `⛔ Withdrawing later does not recall it. Once the recipient has opened it, they have it.`,
        `Nothing was shared. To go ahead:  nmts share "memo.txt" ${recipient} --yes`,
        `⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`,
      ].join("\n"),
    );
    const said = collect();
    assert.equal(await share("memo.txt", recipient, { ...at, yes: true, write: said.write }), 0);
    assert.equal(
      said.lines.join("\n"),
      [
        `  publishing this account's public code for the first time`,
        `memo.txt  →  ${recipient}`,
        ``,
        `  They can download it from now on. Withdrawing the share stops further downloads`,
        `  and cannot reach a copy they have already taken.`,
      ].join("\n"),
    );
    const json = collect();
    assert.equal(await share("memo.txt", recipient, { ...at, yes: true, json: true, write: json.write }), 0);
    assert.deepEqual(json.lines, [JSON.stringify({ id: "sh-new", name: "memo.txt", recipient, fromIndex: 0 })]);
  });
});

test("shares and shares --sent and unshare: every line, text and JSON", async () => {
  await withSandbox(drive, "shell-lists", async (code) => {
    const { address } = await setUp(code);
    const crypt = await loadCrypto();
    const sender = shareKeysOf(crypt, await generateCode());
    const mine = shareKeysAt(crypt, code, 1);
    const payload = sealShare(crypt, {
      keys: sender,
      recipientIdentity: mine.identity,
      recipientAddress: mine.address,
      dek: crypt.generate_dek(),
      itemId: "f9",
      name: "report.pdf",
      size: 3,
      digest: new Uint8Array(32).fill(7),
    });
    state.received = [
      { id: "sh-9", item_id: "f9", size: 9, sender_public_key: b64(sender.identity), to_index: 1, sender_code_revoked: true, created_at: "2026-09-24T00:00:00Z", ...payload },
      { id: "sh-8", item_id: "f8", size: 9, created_at: "2026-09-23T00:00:00Z", ...payload },
    ];
    const text = collect();
    assert.equal(await shares({ ...at, write: text.write }), 0);
    assert.equal(
      text.lines.join("\n"),
      [
        `Shared with this account:`,
        `  sh-9  report.pdf  3 bytes`,
        `      from ${sender.display} (the sender has revoked this code)`,
        `      to #1  ${mine.display}`,
        `  sh-8  (will not open: the sender's published identity is not available)`,
        ``,
        "  `nmts receive <id>` downloads one. `nmts unshare <id>` removes it",
        `  from this list, which does not touch the sender's own file.`,
      ].join("\n"),
    );
    const json = collect();
    assert.equal(await shares({ ...at, json: true, write: json.write }), 0);
    assert.deepEqual(json.lines, [
      JSON.stringify({
        received: [
          { id: "sh-9", name: "report.pdf", size: 3, sender: sender.display, senderRevoked: true, toIndex: 1, createdAt: "2026-09-24T00:00:00Z", problem: null },
          { id: "sh-8", name: null, size: null, sender: null, senderRevoked: false, toIndex: 0, createdAt: "2026-09-23T00:00:00Z", problem: "the sender's published identity is not available" },
        ],
        total: 2,
      }),
    ]);

    drive.sentShares = [{ id: "sh-1", item_id: "f1", recipient_address: address, created_at: "2026-09-20T05:00:00Z" }];
    const sent = collect();
    assert.equal(await sharesSent("memo.txt", { ...at, write: sent.write }), 0);
    assert.deepEqual(sent.lines, ["memo.txt is shared with:", `${address}  since 2026-09-20  share sh-1`]);
    const sentJson = collect();
    assert.equal(await sharesSent("memo.txt", { ...at, json: true, write: sentJson.write }), 0);
    assert.deepEqual(sentJson.lines, [JSON.stringify({ path: "memo.txt", item_id: "f1", shares: drive.sentShares })]);

    const removed = collect();
    assert.equal(await unshare("sh-1", { ...at, write: removed.write }), 0);
    assert.deepEqual(removed.lines, [
      "Removed sh-1.",
      "",
      "  If you sent it, they can no longer download the file, and any copy they already",
      "  took is still theirs. If you received it, the sender's own file is untouched.",
    ]);
    const removedJson = collect();
    assert.equal(await unshare("sh-1", { ...at, json: true, write: removedJson.write }), 0);
    assert.deepEqual(removedJson.lines, [JSON.stringify({ id: "sh-1", removed: true })]);
    sender.wipe();
    mine.wipe();
  });
});

test("receive: the file at the sender's length, then every line, text and JSON", async () => {
  await withSandbox(drive, "shell-receive", async (code) => {
    await setUp(code);
    const crypt = await loadCrypto();
    const sender = shareKeysOf(crypt, await generateCode());
    const mine = shareKeysAt(crypt, code, 0);
    const padded = new Uint8Array(REAL.length + 40);
    padded.set(REAL, 0);
    const stored = await sealFile(code, [padded], REAL.length);
    const derived = crypt.kdf_derive(crypt.account_code_parse(code));
    const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
    const open = (aad: string, ct: string): Uint8Array => crypt.envelope_open(dataKey, new TextEncoder().encode(aad), new Uint8Array(Buffer.from(ct, "base64url")));
    const payload = sealShare(crypt, {
      keys: sender,
      recipientIdentity: mine.identity,
      recipientAddress: mine.address,
      dek: open(AAD.dekWrap, stored.dekWrapped),
      itemId: "f7",
      name: "from-them.txt",
      size: REAL.length,
      digest: open(AAD.contentHash, stored.contentHashCt),
    });
    state.received = [{ id: "sh-7", item_id: "f7", size: 999, sender_public_key: b64(sender.identity), created_at: "2026-09-24T00:00:00Z", ...payload }];
    state.shareParts.set("sh-7", {
      share_id: "sh-7",
      item_id: "f7",
      size: 999,
      parts: stored.parts.map((p, i) => ({ part_index: i, storage_kind: 0, network: 0, blob_id: p.blobId, sealed_len: p.sealed.length })),
    });
    for (const p of stored.parts) bytesState.blobs.set(p.blobId, p.sealed);
    const out = join(testConfigDir("shell-receive"), "got.txt");
    const said = collect();
    assert.equal(await receive("sh-7", { ...at, out, write: said.write }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(out)), REAL);
    assert.deepEqual(said.lines, [
      `from-them.txt  ${REAL.length} bytes`,
      `  from ${sender.display}`,
      `  checked against the hash the sender sealed with it`,
    ]);
    const json = collect();
    assert.equal(await receive("sh-7", { ...at, out, force: true, json: true, write: json.write }), 0);
    assert.deepEqual(json.lines, [
      JSON.stringify({ id: "sh-7", name: "from-them.txt", bytes: REAL.length, from: sender.display, senderRevoked: false, toIndex: 0, parts: 1, out }),
    ]);
    sender.wipe();
    mine.wipe();
  });
});
