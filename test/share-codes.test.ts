// Numbered public codes, through the real engine: code 0 is the code every account already has,
// code N is another one from the same key, and a share opens with the number it was sealed to.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { loadCrypto } from "../src/crypto.ts";
import { openReceived, sealShare, shareKeysOf } from "../src/share.ts";
import { openShareAnyCode, shareKeyRing, shareKeysAt } from "../src/share-codes.ts";
import { generateCode } from "./helpers.ts";

const ITEM = "01hq2x9s7k4m8n0p2q4r6t8v0w";

test("⛔ code 0 is byte for byte the code `shareKeysOf` has always derived", async () => {
  const crypt = await loadCrypto();
  const code = await generateCode();
  const old = shareKeysOf(crypt, code);
  const zero = shareKeysAt(crypt, code, 0);
  assert.equal(zero.index, 0);
  assert.deepEqual(Array.from(zero.address), Array.from(old.address));
  assert.deepEqual(Array.from(zero.identity), Array.from(old.identity));
  assert.equal(zero.display, old.display);
  old.wipe();
  zero.wipe();
});

test("code 1 is a different code from the same key, and the same on every derivation", async () => {
  const crypt = await loadCrypto();
  const code = await generateCode();
  const zero = shareKeysAt(crypt, code, 0);
  const one = shareKeysAt(crypt, code, 1);
  const again = shareKeysAt(crypt, code, 1);
  assert.notDeepEqual(Array.from(one.address), Array.from(zero.address));
  assert.notEqual(one.display, zero.display);
  assert.deepEqual(Array.from(again.identity), Array.from(one.identity));
  assert.equal(one.identity.length, 4989);
  // The bundle fingerprints to the address, so a sender who looks it up can check it.
  assert.deepEqual(Array.from(crypt.share_address_of(one.identity)), Array.from(one.address));
  for (const k of [zero, one, again]) k.wipe();
});

/** A share from `sender` to `recipient`, sealed the way `nmts share` seals one. */
async function shareBetween(sender: Awaited<ReturnType<typeof keys>>, recipient: Awaited<ReturnType<typeof keys>>) {
  const crypt = await loadCrypto();
  const dek = crypt.generate_dek();
  const payload = sealShare(crypt, {
    keys: sender,
    recipientIdentity: recipient.identity,
    recipientAddress: recipient.address,
    dek,
    itemId: ITEM,
    name: "notes.txt",
    size: 5,
    digest: new Uint8Array(createHash("sha256").update("hello").digest()),
  });
  return { payload, dek };
}

async function keys(code: string, index: number) {
  return shareKeysAt(await loadCrypto(), code, index);
}

test("⛔ a share sent as code 2 to code 1 opens with code 1 and names code 2 as its sender", async () => {
  const crypt = await loadCrypto();
  const senderCode = await generateCode();
  const recipientCode = await generateCode();
  const sender = await keys(senderCode, 2);
  const recipient = await keys(recipientCode, 1);
  const { payload, dek } = await shareBetween(sender, recipient);
  const row = {
    id: "sh-1",
    item_id: ITEM,
    size: 1,
    sender_public_key: Buffer.from(sender.identity).toString("base64url"),
    to_index: 1,
    created_at: "2026-09-24T00:00:00Z",
    ...payload,
  };
  const ring = shareKeyRing(crypt, recipientCode);
  const opened = openReceived(crypt, ring.at(1), row);
  assert.equal(opened.problem, null, "it did not open with the code it was sent to");
  assert.equal(opened.name, "notes.txt");
  assert.equal(opened.sender, sender.display, "the sender named is not the code that sent it");
  assert.equal(opened.toIndex, 1);
  assert.deepEqual(Array.from(opened.dek ?? []), Array.from(dek));
  // With code 0 it is somebody else's, and says so rather than failing loudly.
  assert.match(openReceived(crypt, ring.at(0), row).problem ?? "", /did not open/);
  ring.wipe();
  sender.wipe();
  recipient.wipe();
});

test("openShareAnyCode finds the number a share was sealed to, and refuses once for all of them", async () => {
  const crypt = await loadCrypto();
  const recipientCode = await generateCode();
  const sender = shareKeysOf(crypt, await generateCode());
  const recipient = await keys(recipientCode, 1);
  const { payload, dek } = await shareBetween(sender, recipient);
  const sealed = {
    senderPublic: sender.identity,
    envelope: new Uint8Array(Buffer.from(payload.dek_share_ct, "base64url")),
    itemId: ITEM,
    nameCt: new Uint8Array(Buffer.from(payload.name_share_ct, "base64url")),
    digestCt: new Uint8Array(Buffer.from(payload.content_hash_share_ct, "base64url")),
  };
  const found = openShareAnyCode(crypt, recipientCode, [0, 1], sealed);
  assert.equal(found.index, 1);
  assert.deepEqual(Array.from(found.dek), Array.from(dek));
  assert.throws(() => openShareAnyCode(crypt, recipientCode, [0, 2], sealed), /did not open with any of this account's public codes/);
  sender.wipe();
  recipient.wipe();
});
