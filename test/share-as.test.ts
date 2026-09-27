// `nmts share --as <n>`, the first share publishing a code, and the inbox by the code a share came to.
//
// ⛔ WHAT THE SENDER'S CODE IS, IS READ OFF THE ENVELOPE, not off the command's own echo: the
//    recipient learns who sent a file by opening it, so that is where `--as` has to show.

import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";

import { share, shares } from "../src/commands/share.ts";
import { loadCrypto } from "../src/crypto.ts";
import { openReceived, sealShare, shareKeysOf } from "../src/share.ts";
import { shareKeysAt } from "../src/share-codes.ts";
import { collect, entry, startFakeDrive, withSandbox, type FakeDrive } from "./fake-drive.ts";
import { publicCodesState as state } from "./fake-public-codes.ts";
import { generateCode, grantConsents, sealFile } from "./helpers.ts";

let drive: FakeDrive;
before(async () => {
  drive = await startFakeDrive();
});
after(() => drive.close());

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Put one sealed file in the account's list, and a recipient whose code 0 is published. */
async function setUp(code: string): Promise<{ recipientCode: string; recipient: string }> {
  grantConsents(process.env["NMTS_CONFIG_DIR"] ?? "", "plain-env", "share");
  const sealed = await sealFile(code, [new TextEncoder().encode("hello")], 5);
  await drive.serve(code, [entry({ id: "f1", name: "notes.txt", size: 5, dekWrapped: sealed.dekWrapped, contentHashCt: sealed.contentHashCt })]);
  const recipientCode = await generateCode();
  const r = shareKeysOf(await loadCrypto(), recipientCode);
  state.recipients.set(b64(r.address), b64(r.identity));
  const recipient = r.display;
  r.wipe();
  return { recipientCode, recipient };
}

/** Rows for the codes this key derives at `indices`, live. */
async function codesAt(code: string, indices: number[]) {
  const crypt = await loadCrypto();
  return indices.map((index) => {
    const k = shareKeysAt(crypt, code, index);
    const row = { index, address: b64(k.address), created_at: "2026-09-10T00:00:00Z", revoked_at: null, sent: 0, received: 0, support: 0 };
    k.wipe();
    return row;
  });
}

test("⛔ --as sends from that code: the envelope names it, and the recipient opens it", async () => {
  await withSandbox(drive, "share-as", async (code) => {
    const { recipientCode, recipient } = await setUp(code);
    state.codes = await codesAt(code, [0, 1]);
    const out = collect();
    assert.equal(await share("notes.txt", recipient, { server: drive.base, network: "testnet", yes: true, as: "1", json: true, write: out.write }), 0);
    const posted = state.sharesPosted[0];
    assert.ok(posted !== undefined, "nothing was posted");
    const crypt = await loadCrypto();
    const one = shareKeysAt(crypt, code, 1);
    const envelope = new Uint8Array(Buffer.from(String(posted["dek_share_ct"]), "base64url"));
    assert.deepEqual(Array.from(crypt.share_claimed_sender(envelope)), Array.from(one.address), "it was not sent as code 1");
    const opened = openReceived(crypt, shareKeysOf(crypt, recipientCode), {
      id: "sh-new",
      item_id: "f1",
      size: 1,
      sender_public_key: b64(one.identity),
      created_at: "2026-09-24T00:00:00Z",
      dek_share_ct: String(posted["dek_share_ct"]),
      name_share_ct: String(posted["name_share_ct"]),
      content_hash_share_ct: String(posted["content_hash_share_ct"]),
    });
    assert.equal(opened.name, "notes.txt");
    assert.equal(opened.sender, one.display);
    assert.equal(Reflect.get(Object(JSON.parse(out.lines.join(""))), "fromIndex"), 1);
    one.wipe();
  });
});

test("--as a code that is not live refuses before anything is sealed", async () => {
  await withSandbox(drive, "share-as-dead", async (code) => {
    const { recipient } = await setUp(code);
    state.codes = await codesAt(code, [0]);
    await assert.rejects(
      share("notes.txt", recipient, { server: drive.base, network: "testnet", yes: true, as: "2", write: () => {} }),
      /Public code #2 is not a live code of this account/,
    );
    assert.equal(state.sharesPosted.length, 0);
  });
});

test("the first share publishes a code, and a revoked recipient code stops it with the owner's fact", async () => {
  await withSandbox(drive, "share-first", async (code) => {
    const { recipient } = await setUp(code);
    const out = collect();
    assert.equal(await share("notes.txt", recipient, { server: drive.base, network: "testnet", yes: true, write: out.write }), 0);
    assert.deepEqual(state.posts.map((p) => p.index), [0]);
    assert.match(out.lines.join("\n"), /publishing this account's public code for the first time/);
    for (const [address] of state.recipients) state.recipients.set(address, "revoked");
    await assert.rejects(
      share("notes.txt", recipient, { server: drive.base, network: "testnet", yes: true, write: () => {} }),
      /Its owner has revoked that public code/,
    );
  });
});

test("the inbox opens each row with the code it came to, and says which and whether the sender revoked theirs", async () => {
  await withSandbox(drive, "share-inbox", async (code) => {
    const crypt = await loadCrypto();
    const sender = shareKeysOf(crypt, await generateCode());
    const mine = shareKeysAt(crypt, code, 1);
    const dek = crypt.generate_dek();
    const payload = sealShare(crypt, {
      keys: sender,
      recipientIdentity: mine.identity,
      recipientAddress: mine.address,
      dek,
      itemId: "f9",
      name: "report.pdf",
      size: 3,
      digest: new Uint8Array(32).fill(7),
    });
    state.received = [
      { id: "sh-9", item_id: "f9", size: 9, sender_public_key: b64(sender.identity), to_index: 1, sender_code_revoked: true, created_at: "2026-09-24T00:00:00Z", ...payload },
    ];
    const out = collect();
    assert.equal(await shares({ server: drive.base, network: "testnet", write: out.write }), 0);
    const said = out.lines.join("\n");
    assert.match(said, /report\.pdf/, "the row sent to code 1 did not open");
    assert.ok(said.includes(`from ${sender.display}  · the sender has revoked this code`));
    assert.ok(said.includes(`to #1  ${mine.display}`), "which code it came to is not said");
    for (const k of [sender, mine]) k.wipe();
  });
});
