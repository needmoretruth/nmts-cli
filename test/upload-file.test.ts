// A file that does not fit in one part — planned, sealed piece by piece, bought piece by piece,
// and committed once.
//
// ⛔ WHAT THESE TESTS ARE ACTUALLY FOR. Every part is its own purchase, so an interruption between
//    parts is storage that is paid for and invisible. The tests below are about a second run
//    finding each of those purchases instead of making them again — and about the file coming back
//    out as the file, because a multi-part upload that reassembles wrong is money spent on bytes
//    nobody can read.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import { uploadFile, type PlaintextSource } from "../src/upload-file.ts";
import { partKey, readItemRecord, readReservationRecord } from "../src/upload-store.ts";
import { keepLengths } from "../src/shared/lib/crypto/size-padding.ts";
import { apiThat, blobIdOf, isolate, protocolThat } from "./upload-fixture.ts";
import { generateCode } from "./helpers.ts";

/** Plaintext held in memory, handed out in small pieces so the reader is exercised too. */
function sourceOf(bytes: Uint8Array, piece = 1000): PlaintextSource {
  return {
    size: bytes.length,
    async *read(offset: number, length: number) {
      for (let at = 0; at < length; at += piece) {
        yield bytes.subarray(offset + at, offset + Math.min(at + piece, length));
      }
    },
  };
}

async function keysFor(code: string) {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const dataKey = derived.slice(from, to);
  derived.fill(0);
  return { crypt, dataKey };
}

function bodyOf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 37) % 251;
  return bytes;
}

async function inputFor(api: ReturnType<typeof apiThat>["api"], protocol: ReturnType<typeof protocolThat>, bytes: Uint8Array, partSize: number) {
  const { crypt, dataKey } = await keysFor(await generateCode());
  return {
    input: {
      api,
      protocol,
      crypt,
      dataKey,
      source: sourceOf(bytes),
      name: "big.bin",
      parentId: null,
      destination: "",
      relayUrl: "https://relay.example",
      epochs: 2,
      currentEpoch: 40,
      partSize,
      padding: { rule: "padme" as const, unitBytes: 1024 * 1024 },
    },
    crypt,
    dataKey,
  };
}

test("a file larger than one part is bought part by part and committed once", async () => {
  const dir = isolate();
  try {
    const bytes = bodyOf(10_000);
    const committed: Record<string, unknown>[] = [];
    const { api, calls } = apiThat({
      async createItem(body) {
        // ⚠ The override replaces the counting one, so it counts for itself. A test that asserted
        //   on a counter its own fake had stopped incrementing would pass on any number of commits.
        calls.createItem += 1;
        committed.push(body);
        return { id: "item-multi" };
      },
    });
    const { input, dataKey } = await inputFor(api, protocolThat(), bytes, 4000);
    const result = await uploadFile(input);
    dataKey.fill(0);

    assert.equal(result.itemId, "item-multi");
    assert.equal(result.parts, 3, "10,000 bytes in 4,000-byte parts is three parts");
    assert.equal(calls.reserve, 3, "one reservation per part");
    assert.equal(calls.uploaded, 3, "one certificate per part");
    assert.equal(calls.createItem, 1, "⛔ ONE commit for the file, not one per part");

    const parts = committed[0]?.["parts"];
    assert.ok(Array.isArray(parts));
    assert.deepEqual(
      parts.map((part: Record<string, unknown>) => part["part_index"]),
      [0, 1, 2],
      "the indices are contiguous from zero, which is what the server checks",
    );
    // The item's size is the SUM of the sealed lengths — the server derives it and refuses a
    // client-sent number that disagrees.
    const sum = parts.reduce((n: number, part: Record<string, unknown>) => n + Number(part["sealed_len"]), 0);
    assert.equal(committed[0]?.["size"], sum);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ every part is sealed under ONE file key, and the parts are the file", async () => {
  // A part sealed under its own key would be a file that is paid for, present and unopenable.
  const dir = isolate();
  try {
    const bytes = bodyOf(9_500);
    const stored: { blobId: string; bytes: Uint8Array }[] = [];
    const protocol = protocolThat({
      async uploadToRelay({ blobId, bytes: pushed }) {
        stored.push({ blobId, bytes: pushed });
        return { signers: [0], serialized_message_b64: "bQ", signature_b64: "cw" };
      },
    });
    const { input, crypt, dataKey } = await inputFor(apiThat().api, protocol, bytes, 4000);
    const result = await uploadFile(input);

    const dek = crypt.envelope_open(
      dataKey,
      new TextEncoder().encode(AAD.dekWrap),
      Buffer.from(result.entry.dekWrapped, "base64url"),
    );
    // ⛔ READ THE WAY A READER READS. The last part is sealed from MORE bytes than it contributes —
    //    that is the padding that hides the file's true size — so the parts do not simply
    //    concatenate. `keepLengths` is the arithmetic that says how much of each one is the file,
    //    and using it here is what makes this test agree with the download path rather than with
    //    the upload path's own idea of itself.
    const streams = stored.map((part) => crypt.stream_decrypt_all(dek, part.bytes));
    const keep = keepLengths(bytes.length, streams.map((s) => s.length));
    const opened = Buffer.concat(streams.map((s, i) => Buffer.from(s.subarray(0, keep[i] ?? 0))));
    assert.ok(opened.equals(Buffer.from(bytes)), "the parts reassemble to the file");
    assert.ok(
      (streams.at(-1)?.length ?? 0) > (keep.at(-1) ?? 0),
      "the last part was not padded, so the file's exact length is on the wire",
    );
    assert.equal(result.entry.plaintextLen, bytes.length, "the list records the FILE's length");
    dek.fill(0);
    dataKey.fill(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run that died after the first part does not buy that part again", async () => {
  const dir = isolate();
  try {
    const bytes = bodyOf(10_000);
    // The relay refuses everything after the first part, so parts 1 and 2 are never filled.
    let pushes = 0;
    const first = apiThat();
    const { input, dataKey } = await inputFor(
      first.api,
      protocolThat({
        async uploadToRelay({ blobId, bytes: pushed }) {
          pushes += 1;
          if (pushes > 1) throw new Error("relay is down");
          const actual = blobIdOf(pushed);
          if (actual !== blobId) throw new Error("relay refuses");
          return { signers: [0], serialized_message_b64: "bQ", signature_b64: "cw" };
        },
      }),
      bytes,
      4000,
    );
    await assert.rejects(uploadFile(input));
    assert.equal(first.calls.reserve, 2, "it stopped inside the second part");

    // Second run: same file, same destination, same account.
    const second = apiThat();
    const again = { ...input, api: second.api, protocol: protocolThat() };
    const result = await uploadFile(again);
    dataKey.fill(0);

    assert.equal(result.itemId, "item-1");
    assert.equal(
      second.calls.reserve,
      1,
      "⛔ only the part that was never bought is bought — the other two were already paid for",
    );
    assert.equal(second.calls.status, 2, "the two paid parts are asked about instead");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a resume writes the RECORDED key into the list, not a fresh one", async () => {
  const dir = isolate();
  try {
    const bytes = bodyOf(6_000);
    const { input, dataKey } = await inputFor(
      apiThat().api,
      protocolThat({
        async uploadToRelay() {
          throw new Error("relay is down");
        },
      }),
      bytes,
      4000,
    );
    await assert.rejects(uploadFile(input));

    const second = await uploadFile({ ...input, api: apiThat().api, protocol: protocolThat() });
    const stored = readReservationRecord(partKey(second.fileKey, 0));
    assert.equal(
      second.entry.dekWrapped,
      stored?.dekWrapped,
      "the list would otherwise be given a key that does not open the stored bytes",
    );
    dataKey.fill(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a different part size on a resume is refused, not silently obeyed", async () => {
  // The bytes on disk were sealed as part i of n and paid for as that. Splitting the file another
  // way would file storage under the wrong position — a file that downloads wrong, years later.
  const dir = isolate();
  try {
    const bytes = bodyOf(10_000);
    const { input, dataKey } = await inputFor(
      apiThat().api,
      protocolThat({
        async uploadToRelay() {
          throw new Error("relay is down");
        },
      }),
      bytes,
      4000,
    );
    await assert.rejects(uploadFile(input));
    await assert.rejects(
      uploadFile({ ...input, api: apiThat().api, protocol: protocolThat(), partSize: 5000 }),
      /part 1 of 3 and this run is treating it as part 1 of 2/,
    );
    dataKey.fill(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that is already committed asks the server for nothing at all", async () => {
  const dir = isolate();
  try {
    const bytes = bodyOf(6_000);
    const { input, dataKey } = await inputFor(apiThat().api, protocolThat(), bytes, 4000);
    const first = await uploadFile(input);
    assert.equal(readItemRecord(first.fileKey)?.itemId, first.itemId);

    const again = apiThat();
    const second = await uploadFile({ ...input, api: again.api, protocol: protocolThat() });
    dataKey.fill(0);
    assert.equal(second.itemId, first.itemId);
    assert.deepEqual(
      [again.calls.reserve, again.calls.status, again.calls.uploaded, again.calls.createItem],
      [0, 0, 0, 0],
      "⛔ a committed file needs nothing from the server; the list is all that is missing",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that fits in one part still goes through the same path", async () => {
  const dir = isolate();
  try {
    const bytes = bodyOf(500);
    const { api, calls } = apiThat();
    const { input, dataKey } = await inputFor(api, protocolThat(), bytes, 4000);
    const result = await uploadFile(input);
    dataKey.fill(0);
    assert.equal(result.parts, 1);
    assert.deepEqual([calls.reserve, calls.uploaded, calls.createItem], [1, 1, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
