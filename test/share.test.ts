// Sharing, between two actual accounts.
//
// ⛔ TWO ACCOUNTS, NOT ONE — but that still does not pin the derivation offsets, and saying it did
//    would be the third version of the same mistake in one day. Both accounts read their secrets
//    through the SAME table, so a table that is four bytes off makes two parties who are wrong in
//    exactly the same way, and they agree perfectly. Measured: shifting the key-agreement seed and
//    then the sender secret left all nine of these green.
//    ▶ The offsets are held by `web/test/cli-kdf-offsets.test.ts`, against the browser's own table.
//      Any check that reads both sides from one table can only prove the table is used
//      consistently — never that it is right.
//
// What two accounts DO prove, and one cannot: that a sender and a recipient are different roles
// with different secrets, that a stranger holding neither gets nothing, that the sealed name and
// the file id are committed to so a server cannot swap either, and that the whole exchange runs in
// this tool with no browser anywhere in it.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { AAD, loadCrypto } from "../src/crypto.ts";
import {
  addressFromTyped,
  identityMatches,
  openReceived,
  openSharedDigest,
  sealShare,
  shareKeysOf,
  type ReceivedRow,
} from "../src/share.ts";
import { generateCode } from "./helpers.ts";

const ITEM_ID = "01hq2x9s7k4m8n0p2q4r6t8v0w";

async function party() {
  const crypt = await loadCrypto();
  return { crypt, keys: shareKeysOf(crypt, await generateCode()) };
}

/** A share as it would sit in the server's table, built the way `nmts share` builds it. */
function rowFor(
  crypt: Awaited<ReturnType<typeof loadCrypto>>,
  sender: Awaited<ReturnType<typeof party>>,
  recipient: Awaited<ReturnType<typeof party>>,
  over: { name?: string; size?: number; dek?: Uint8Array; digest?: Uint8Array } = {},
): { row: ReceivedRow; dek: Uint8Array; digest: Uint8Array } {
  const dek = over.dek ?? crypt.generate_dek();
  const digest = over.digest ?? new Uint8Array(createHash("sha256").update("the file").digest());
  const payload = sealShare(crypt, {
    keys: sender.keys,
    recipientIdentity: recipient.keys.identity,
    recipientAddress: recipient.keys.address,
    dek,
    itemId: ITEM_ID,
    name: over.name ?? "notes.txt",
    size: over.size ?? 4096,
    digest,
  });
  return {
    dek,
    digest,
    row: {
      id: "sh1",
      item_id: ITEM_ID,
      size: 4184,
      sender_public_key: Buffer.from(sender.keys.identity).toString("base64url"),
      created_at: "2026-08-24T00:00:00Z",
      ...payload,
    },
  };
}

test("⛔ a file shared from one account opens in the other — key, name, size and sender", async () => {
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  const { row, dek, digest } = rowFor(crypt, sender, recipient, { name: "report.pdf", size: 9001 });

  const opened = openReceived(crypt, recipient.keys, row);
  assert.equal(opened.problem, null, opened.problem ?? "");
  assert.equal(opened.name, "report.pdf");
  assert.equal(opened.size, 9001, "the REAL length comes from what the sender sealed");
  assert.equal(opened.sender, sender.keys.display, "and it is the sender's own address");
  assert.deepEqual(Array.from(opened.dek ?? []), Array.from(dek), "the file key came through");
  assert.deepEqual(
    Array.from(openSharedDigest(crypt, opened.dek ?? new Uint8Array(), opened.digestCt) ?? []),
    Array.from(digest),
    "and the hash the bytes get checked against",
  );
  opened.dek?.fill(0);
  sender.keys.wipe();
  recipient.keys.wipe();
});

test("⛔ a third account cannot open a share it was not sent", async () => {
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  const stranger = await party();
  const { row } = rowFor(crypt, sender, recipient);

  const opened = openReceived(crypt, stranger.keys, row);
  assert.equal(opened.dek, null, "a stranger got the file's key");
  assert.equal(opened.sender, null, "and would have been shown who it claims to be from");
  assert.match(opened.problem ?? "", /did not open/);
  sender.keys.wipe();
  recipient.keys.wipe();
  stranger.keys.wipe();
});

test("⛔ the sealed name is committed to — rewriting it closes the envelope", async () => {
  // This is the property that stops a server serving a file under a name nobody sealed: the name's
  // exact bytes are hashed into the key that wraps the file key.
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  const honest = rowFor(crypt, sender, recipient, { name: "wages.csv" });
  const other = rowFor(crypt, sender, recipient, { name: "holiday.jpg" });

  const swapped: ReceivedRow = { ...honest.row, name_share_ct: other.row.name_share_ct };
  const opened = openReceived(crypt, recipient.keys, swapped);
  assert.equal(opened.dek, null, "a swapped name still handed over the key");
  sender.keys.wipe();
  recipient.keys.wipe();
});

test("⛔ the file's id is committed to as well", async () => {
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  const { row } = rowFor(crypt, sender, recipient);

  const moved: ReceivedRow = { ...row, item_id: "01hq2x9s7k4m8n0p2q4r6t8v0x" };
  assert.equal(openReceived(crypt, recipient.keys, moved).dek, null);
  sender.keys.wipe();
  recipient.keys.wipe();
});

test("a row that will not open is still listed, with a reason and no sender", async () => {
  // Dropping it would tell the account it was sent less than it was, and leave a gap nobody can
  // notice. The reason goes on its own line instead.
  const crypt = await loadCrypto();
  const recipient = await party();
  const row: ReceivedRow = {
    id: "sh9",
    item_id: ITEM_ID,
    size: 100,
    created_at: "2026-08-24T00:00:00Z",
    dek_share_ct: Buffer.from(new Uint8Array(1240)).toString("base64url"),
    name_share_ct: Buffer.from(new Uint8Array(200)).toString("base64url"),
    content_hash_share_ct: Buffer.from(new Uint8Array(104)).toString("base64url"),
  };
  const opened = openReceived(crypt, recipient.keys, row);
  assert.equal(opened.id, "sh9", "the row is still there");
  assert.equal(opened.name, null);
  assert.equal(opened.sender, null);
  assert.match(opened.problem ?? "", /identity is not available/);
  recipient.keys.wipe();
});

test("a file with no recorded hash is refused rather than shared unprovable", async () => {
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  assert.throws(
    () =>
      sealShare(crypt, {
        keys: sender.keys,
        recipientIdentity: recipient.keys.identity,
        recipientAddress: recipient.keys.address,
        dek: crypt.generate_dek(),
        itemId: ITEM_ID,
        name: "a.txt",
        size: 1,
        digest: new Uint8Array(0),
      }),
    /no recorded content hash/,
  );
  sender.keys.wipe();
  recipient.keys.wipe();
});

test("⛔ an identity that does not fingerprint to the address asked for is refused", async () => {
  const crypt = await loadCrypto();
  const sender = await party();
  const intended = await party();
  const substitute = await party();

  assert.equal(identityMatches(crypt, intended.keys.identity, intended.keys.address), true);
  assert.equal(
    identityMatches(crypt, substitute.keys.identity, intended.keys.address),
    false,
    "a server answering with somebody else's identity would be encrypted to",
  );
  // And the engine refuses it too, so a caller that skipped the check above still cannot send.
  assert.throws(() =>
    sealShare(crypt, {
      keys: sender.keys,
      recipientIdentity: substitute.keys.identity,
      recipientAddress: intended.keys.address,
      dek: crypt.generate_dek(),
      itemId: ITEM_ID,
      name: "a.txt",
      size: 1,
      digest: new Uint8Array(32),
    }),
  );
  sender.keys.wipe();
  intended.keys.wipe();
  substitute.keys.wipe();
});

test("a mistyped address is caught here, not by asking the server about it", async () => {
  const crypt = await loadCrypto();
  const me = await party();
  const typed = me.keys.display;
  assert.deepEqual(
    Array.from(addressFromTyped(crypt, ` ${typed} `)),
    Array.from(me.keys.address),
    "surrounding space is not a different address",
  );
  const symbols = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const at = typed.search(/[0-9A-Z]/);
  const wrong = symbols[(symbols.indexOf(typed[at] ?? "0") + 1) % symbols.length] ?? "0";
  assert.throws(
    () => addressFromTyped(crypt, `${typed.slice(0, at)}${wrong}${typed.slice(at + 1)}`),
    /is not a public code/,
  );
  me.keys.wipe();
});

test("the name is sealed under sharing's own separator, not the account's", async () => {
  // ⛔ A recipient holds the file key and nothing else, so the name has to travel under that key.
  //    Sealing it under the account's own separator would produce something only the SENDER could
  //    open, which is a share that hands over a file with no name.
  const crypt = await loadCrypto();
  const sender = await party();
  const recipient = await party();
  const { row, dek } = rowFor(crypt, sender, recipient);
  const nameCt = new Uint8Array(Buffer.from(row.name_share_ct, "base64url"));
  assert.throws(
    () => crypt.envelope_open(dek, new TextEncoder().encode(AAD.fileList), nameCt),
    "the name opened under the wrong separator",
  );
  assert.ok(crypt.envelope_open(dek, new TextEncoder().encode(AAD.shareName), nameCt).length > 0);
  sender.keys.wipe();
  recipient.keys.wipe();
});
