// The account's sharing identity, derived in this tool and checked against itself.
//
// ⛔ THE OFFSETS ARE THE WHOLE RISK, AND THIS FILE DOES NOT HOLD THEM. Three of the five secrets
//    behind a sharing identity are slices of one derived buffer. A shifted offset does not throw —
//    it derives a DIFFERENT identity, and shares sent to this account then do not open. But every
//    check available HERE uses the same table on both sides, so it stays green while being wrong:
//    two of the three shifts were measured green before this comment was written.
//    ▶ The offsets are pinned in `web/test/cli-kdf-offsets.test.ts`, against the browser's table,
//      which is where the numbers actually come from. What this file proves is that the engine's
//      whole sharing surface is reachable from Node, and that the payload commitment bites.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DERIVED, loadCrypto } from "../src/crypto.ts";
import { generateCode } from "./helpers.ts";

async function derivedFor(code: string) {
  const crypt = await loadCrypto();
  const buffer = crypt.kdf_derive(crypt.account_code_parse(code));
  const slice = (range: readonly [number, number]) => buffer.slice(range[0], range[1]);
  return { crypt, buffer, slice };
}

test("the identity built from the three seeds fingerprints to the derived address", async () => {
  // ⚠ Pins the SIGNING seed only — the address is a fingerprint of the signing half. Measured:
  //   shifting that one turns this red; shifting the other two does not.
  const { crypt, buffer, slice } = await derivedFor(await generateCode());
  const identity = crypt.share_public_key(
    slice(DERIVED.shareKemSeed),
    slice(DERIVED.shareAuthSecret),
    slice(DERIVED.shareSigSeed),
  );
  assert.equal(identity.length, 4989, "the published bundle has one fixed length");
  assert.deepEqual(
    Array.from(crypt.share_address_of(identity)),
    Array.from(slice(DERIVED.shareAddress)),
    "a shifted seed offset would publish an identity under an address nobody can reach",
  );
  buffer.fill(0);
});

test("the identity is the same every time — a second device publishes the same bytes", async () => {
  // ⛔ NOT A STYLE POINT (NCF-3 §5.1). The self-signature uses the deterministic signing variant.
  //    If it were hedged, every machine would derive a different bundle from the same code, and
  //    the server takes the FIRST one forever — locking the account out of its own second device.
  const code = await generateCode();
  const first = await derivedFor(code);
  const second = await derivedFor(code);
  const of = (d: Awaited<ReturnType<typeof derivedFor>>) =>
    Array.from(
      d.crypt.share_public_key(
        d.slice(DERIVED.shareKemSeed),
        d.slice(DERIVED.shareAuthSecret),
        d.slice(DERIVED.shareSigSeed),
      ),
    );
  assert.deepEqual(of(first), of(second));
  first.buffer.fill(0);
  second.buffer.fill(0);
});

test("a share wrapped to this account opens again — the whole flow runs in this tool", async () => {
  // ⚠ THIS DOES NOT PIN THE OFFSETS, and saying it did would be the worst shape a test can have.
  //   Wrapping to yourself uses the same seeds on both sides, so three shifted offsets stay
  //   internally consistent and it opens anyway — measured: shifting the key-agreement seed or the
  //   sender secret by four bytes left this green. What it DOES prove is that every step is
  //   reachable from Node with the vendored engine, and that the commitment below bites.
  //   The offsets are held by `web/test/cli-kdf-offsets.test.ts`, against the browser's own table.
  const { crypt, buffer, slice } = await derivedFor(await generateCode());
  const identity = crypt.share_public_key(
    slice(DERIVED.shareKemSeed),
    slice(DERIVED.shareAuthSecret),
    slice(DERIVED.shareSigSeed),
  );
  const address = slice(DERIVED.shareAddress);
  const dek = crypt.generate_dek();
  const itemId = "01hq2x9s7k4m8n0p2q4r6t8v0w";
  const nameCt = new Uint8Array(73).fill(4);
  const digestCt = new Uint8Array(104).fill(5);

  const envelope = crypt.share_wrap_dek(
    slice(DERIVED.shareAuthSecret),
    slice(DERIVED.shareSigSeed),
    identity,
    address,
    dek,
    itemId,
    nameCt,
    digestCt,
  );
  assert.equal(envelope.length, 1240, "the envelope has one fixed length");
  assert.deepEqual(
    Array.from(crypt.share_claimed_sender(envelope)),
    Array.from(address),
    "the envelope names who it claims to be from",
  );
  const opened = crypt.share_unwrap_dek(
    slice(DERIVED.shareKemSeed),
    slice(DERIVED.shareAuthSecret),
    slice(DERIVED.shareSigSeed),
    identity,
    envelope,
    itemId,
    nameCt,
    digestCt,
  );
  assert.deepEqual(Array.from(opened), Array.from(dek), "the file key came back");
  dek.fill(0);
  buffer.fill(0);
});

test("⛔ the three sealed values are hashed into the wrapping key — changing one closes it", async () => {
  // The length-prefixed commitment is what stops a server rewriting the name a share arrived with.
  const { crypt, buffer, slice } = await derivedFor(await generateCode());
  const identity = crypt.share_public_key(
    slice(DERIVED.shareKemSeed),
    slice(DERIVED.shareAuthSecret),
    slice(DERIVED.shareSigSeed),
  );
  const address = slice(DERIVED.shareAddress);
  const dek = crypt.generate_dek();
  const itemId = "01hq2x9s7k4m8n0p2q4r6t8v0w";
  const nameCt = new Uint8Array(73).fill(4);
  const digestCt = new Uint8Array(104).fill(5);
  const envelope = crypt.share_wrap_dek(
    slice(DERIVED.shareAuthSecret), slice(DERIVED.shareSigSeed), identity, address,
    dek, itemId, nameCt, digestCt,
  );
  const tampered = new Uint8Array(nameCt);
  tampered[0] = 9;
  assert.throws(() =>
    crypt.share_unwrap_dek(
      slice(DERIVED.shareKemSeed), slice(DERIVED.shareAuthSecret), slice(DERIVED.shareSigSeed),
      identity, envelope, itemId, tampered, digestCt,
    ),
  );
  assert.throws(
    () =>
      crypt.share_unwrap_dek(
        slice(DERIVED.shareKemSeed), slice(DERIVED.shareAuthSecret), slice(DERIVED.shareSigSeed),
        identity, envelope, "01hq2x9s7k4m8n0p2q4r6t8v0x", nameCt, digestCt,
      ),
    "a different item id must not open it",
  );
  dek.fill(0);
  buffer.fill(0);
});

test("two accounts do not share an identity", async () => {
  const a = await derivedFor(await generateCode());
  const b = await derivedFor(await generateCode());
  assert.notDeepEqual(
    Array.from(a.slice(DERIVED.shareAddress)),
    Array.from(b.slice(DERIVED.shareAddress)),
  );
  a.buffer.fill(0);
  b.buffer.fill(0);
});

test("a typed address round-trips, and a mistyped one is refused here rather than at the server", async () => {
  const { crypt, buffer, slice } = await derivedFor(await generateCode());
  const address = slice(DERIVED.shareAddress);
  const typed = crypt.share_address_display(address);
  assert.deepEqual(Array.from(crypt.share_address_parse(typed)), Array.from(address));

  // Change one symbol. The check symbol is what makes this fail without a network call.
  const symbols = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const at = typed.search(/[0-9A-Z]/);
  const wrong = symbols[(symbols.indexOf(typed[at] ?? "0") + 1) % symbols.length] ?? "0";
  const mistyped = `${typed.slice(0, at)}${wrong}${typed.slice(at + 1)}`;
  assert.throws(() => crypt.share_address_parse(mistyped));
  buffer.fill(0);
});
