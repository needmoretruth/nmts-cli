// Sealing a file for upload — and proving the tool's own reader opens what its writer produced.
//
// ⛔ THE ROUND TRIP IS THE POINT. Sealing and opening are written in two different files, against
//    the same frozen format, and neither one is checked by the other at compile time. A test that
//    only asserted "sealing produced some bytes" would pass on a wrong nonce, a wrong associated
//    data string and a wrong key -- and the failure would arrive as a file somebody paid to store
//    and could never open again.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import { DEFAULT_PART_BYTES, sealedLenFor, sealFile, sealPart } from "../src/seal.ts";
import { generateCode } from "./helpers.ts";

async function keysFor(code: string): Promise<{ crypt: Awaited<ReturnType<typeof loadCrypto>>; dataKey: Uint8Array }> {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const dataKey = derived.slice(from, to);
  derived.fill(0);
  return { crypt, dataKey };
}

test("what `put` seals is what `get` opens — the same bytes come back", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const plaintext = new Uint8Array(5000);
  for (let i = 0; i < plaintext.length; i += 1) plaintext[i] = (i * 31) % 251;

  const sealed = await sealFile(crypt, dataKey, plaintext);

  // Open it the way `download.ts` does: unwrap the file key, then decrypt the stream.
  const dek = crypt.envelope_open(
    dataKey,
    new TextEncoder().encode(AAD.dekWrap),
    Buffer.from(sealed.dekWrapped, "base64url"),
  );
  const recovered = crypt.stream_decrypt_all(dek, sealed.sealed);
  assert.deepEqual(Array.from(recovered), Array.from(plaintext));

  // …and the recorded hash is the hash of the plaintext, checkable only with the account's key.
  const expected = crypt.envelope_open(
    dataKey,
    new TextEncoder().encode(AAD.contentHash),
    Buffer.from(sealed.contentHashCt, "base64url"),
  );
  assert.deepEqual(
    Array.from(expected),
    Array.from(new Uint8Array(createHash("sha256").update(plaintext).digest())),
  );
  dataKey.fill(0);
});

test("⛔ the same file sealed twice does not produce the same bytes", async () => {
  // A fresh file key per file, and a fresh nonce inside the stream. Identical ciphertext for
  // identical plaintext would tell the storage network which of its blobs are the same file.
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
  const a = await sealFile(crypt, dataKey, plaintext);
  const b = await sealFile(crypt, dataKey, plaintext);
  assert.notDeepEqual(Array.from(a.sealed), Array.from(b.sealed));
  assert.notEqual(a.dekWrapped, b.dekWrapped);
  dataKey.fill(0);
});

test("the wrapped key does not open under a different account", async () => {
  const mine = await generateCode();
  const theirs = await generateCode();
  const { crypt, dataKey } = await keysFor(mine);
  const other = await keysFor(theirs);
  const sealed = await sealFile(crypt, dataKey, new Uint8Array([7, 7, 7]));
  assert.throws(() =>
    crypt.envelope_open(
      other.dataKey,
      new TextEncoder().encode(AAD.dekWrap),
      Buffer.from(sealed.dekWrapped, "base64url"),
    ),
  );
  dataKey.fill(0);
  other.dataKey.fill(0);
});

test("⛔ the associated data is load-bearing — a file key does not open as a content hash", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const sealed = await sealFile(crypt, dataKey, new Uint8Array([1, 2, 3]));
  assert.throws(
    () =>
      crypt.envelope_open(
        dataKey,
        new TextEncoder().encode(AAD.contentHash),
        Buffer.from(sealed.dekWrapped, "base64url"),
      ),
    "an envelope sealed for one purpose opened as another",
  );
  dataKey.fill(0);
});

test("the two lengths are different numbers, and both are reported", async () => {
  // The server is told the SEALED length -- that is what storage is bought for and what credits
  // count. The file list records the PLAINTEXT length. Mixing them up is a file that downloads
  // short, or an account charged for the wrong thing.
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const plaintext = new Uint8Array(1000);
  const sealed = await sealFile(crypt, dataKey, plaintext);
  assert.equal(sealed.plaintextLen, 1000);
  assert.ok(sealed.sealedLen > sealed.plaintextLen, "the sealed stream carries a header and tags");
  assert.equal(sealed.sealed.length, sealed.sealedLen);
  dataKey.fill(0);
});

test("an empty file is refused rather than sent", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  await assert.rejects(sealFile(crypt, dataKey, new Uint8Array(0)), /empty/i);
  dataKey.fill(0);
});

test("⛔ the sealed length is arithmetic, and the engine agrees with the arithmetic", async () => {
  // The price is quoted BEFORE the file is read, from `sealedLenFor` alone. If that arithmetic and
  // the format ever disagreed, every quote would be wrong — and the failure would arrive as a
  // reservation for the wrong number of bytes, after the credits moved. So the real engine is the
  // oracle here, not a second copy of the same constants.
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const chunk = 4 * 2 ** 20;
  for (const length of [1, 1000, chunk - 1, chunk, chunk + 1, chunk * 2, chunk * 2 + 5]) {
    const sealed = await sealPart(crypt, crypt.generate_dek(), oneChunk(new Uint8Array(length)), {
      index: 0,
      total: 1,
      plaintextLen: length,
    });
    assert.equal(sealed.length, sealedLenFor(length), `sealed length for ${length} plaintext bytes`);
  }
  dataKey.fill(0);
});

test("a file in several parts comes back as the file — in order, under one key", async () => {
  // ⛔ THE PROPERTY THAT MAKES A LARGE UPLOAD SAFE. Each part is its own stream with its own nonce,
  //    all under ONE file key, and the reader concatenates them. A part sealed under a second key,
  //    or one whose declared placement did not match, would produce a file that is paid for and
  //    unreadable — which is the failure this whole path exists to make impossible.
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const whole = new Uint8Array(9000);
  for (let i = 0; i < whole.length; i += 1) whole[i] = (i * 17) % 253;
  const dek = crypt.generate_dek();
  const ranges = [
    { index: 0, offset: 0, length: 4000 },
    { index: 1, offset: 4000, length: 4000 },
    { index: 2, offset: 8000, length: 1000 },
  ];
  const parts: Uint8Array[] = [];
  for (const range of ranges) {
    parts.push(
      await sealPart(crypt, dek, oneChunk(whole.subarray(range.offset, range.offset + range.length)), {
        index: range.index,
        total: ranges.length,
        plaintextLen: range.length,
      }),
    );
  }
  const opened = Buffer.concat(parts.map((part) => Buffer.from(crypt.stream_decrypt_all(dek, part))));
  assert.deepEqual(Array.from(opened), Array.from(whole));
  dek.fill(0);
  dataKey.fill(0);
});

test("⛔ each part's header says where it sits, so one cannot stand in for another", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const dek = crypt.generate_dek();
  const parts = [];
  for (let index = 0; index < 3; index += 1) {
    parts.push(
      await sealPart(crypt, dek, oneChunk(new Uint8Array([index, index, index])), {
        index,
        total: 3,
        plaintextLen: 3,
      }),
    );
  }
  // part_index and part_total live at bytes 8..12 and 12..16 of the 72-byte header (NCF-3 §4.1).
  parts.forEach((part, index) => {
    const header = Buffer.from(part);
    assert.equal(header.readUInt32LE(8), index, "the part says which one it is");
    assert.equal(header.readUInt32LE(12), 3, "and how many there are");
  });
  dek.fill(0);
  dataKey.fill(0);
});

test("a part given fewer bytes than it declared is refused, not sealed short", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const dek = crypt.generate_dek();
  await assert.rejects(
    sealPart(crypt, dek, oneChunk(new Uint8Array(10)), { index: 0, total: 2, plaintextLen: 20 }),
    /declared 20 bytes and read 10/,
  );
  dek.fill(0);
  dataKey.fill(0);
});

test("a part given more bytes than it declared is refused before it can finish", async () => {
  const code = await generateCode();
  const { crypt, dataKey } = await keysFor(code);
  const dek = crypt.generate_dek();
  await assert.rejects(
    sealPart(crypt, dek, oneChunk(new Uint8Array(30)), { index: 1, total: 2, plaintextLen: 20 }),
    /more bytes than it declared/,
  );
  dek.fill(0);
  dataKey.fill(0);
});

test("the default part size is the memory ceiling this tool always had", () => {
  // ⚠ Growing past one part must not make an upload that worked yesterday run out of memory today.
  assert.equal(DEFAULT_PART_BYTES, 64 * 2 ** 20);
});

async function* oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
