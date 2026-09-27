// Which upload a record belongs to — the same file put again, a record from an earlier version,
// and two runs of one file at once.
//
// ⛔ THE FAKE SERVER KEEPS THE SERVER'S TWO IDEMPOTENCY RULES, and that is what these tests are for.
//    A reservation key that already names a blob refuses a different blob (409
//    `SPONSORED_IDEM_MISMATCH`) and replays the same one; a commit key that already made an item
//    answers that item. A fake that accepted any key twice could not see the defect: the same file
//    put in the same place again, after the first upload's records were forgotten, rebuilt the
//    first upload's keys.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { ServerError } from "../src/api.ts";
import { DERIVED, loadCrypto } from "../src/crypto.ts";
import { uploadFile, type FileUploadInput, type PlaintextSource } from "../src/upload-file.ts";
import { forgetUpload, UPLOAD_CONFLICT } from "../src/upload-run.ts";
import { buyAndPushPart } from "../src/upload.ts";
import {
  clearItemRecord,
  clearReservation,
  partKey,
  readItemRecord,
  readReservationRecord,
  writeItemRecord,
  writeReservation,
  type Reservation,
} from "../src/upload-store.ts";
import { UploadError, type UploadApi } from "../src/upload-wire.ts";
import { generateCode } from "./helpers.ts";
import { SEALED, apiThat, inputFor, isolate, protocolThat, uploadOnePart } from "./upload-fixture.ts";

/** The server's reservation and commit rows, keyed the way the server keys them. */
function serverThat(): { api: UploadApi; reserveKeys: string[]; commitKeys: string[] } {
  const rows = new Map<string, { ledgerId: number; blobId: string; size: number }>();
  const items = new Map<string, string>();
  const reserveKeys: string[] = [];
  const commitKeys: string[] = [];
  let next = 0;
  const api: UploadApi = {
    async reserve(body) {
      reserveKeys.push(body.idempotency_key);
      const row = rows.get(body.idempotency_key);
      if (row !== undefined && (row.blobId !== body.blob_id || row.size !== body.size)) {
        throw new ServerError(409, {
          code: "SPONSORED_IDEM_MISMATCH",
          message: "this idempotency key is already reserved for different bytes",
        }, null);
      }
      const kept = row ?? { ledgerId: (next += 1), blobId: body.blob_id, size: body.size };
      rows.set(body.idempotency_key, kept);
      return { ledger_id: kept.ledgerId, state: "registered", blob_object_id: "0xblob", register_tx_digest: "0xtx", credits_spent: 1 };
    },
    async status(ledgerId) {
      return { ledger_id: ledgerId, state: "registered", blob_object_id: "0xblob", register_tx_digest: "0xtx" };
    },
    async uploaded() {
      return {};
    },
    async createItem(_body, key) {
      commitKeys.push(key);
      const id = items.get(key) ?? `item-${items.size + 1}`;
      items.set(key, id);
      return { id };
    },
  };
  return { api, reserveKeys, commitKeys };
}

function sourceOf(bytes: Uint8Array): PlaintextSource {
  return {
    size: bytes.length,
    async *read(offset: number, length: number) {
      yield bytes.subarray(offset, offset + length);
    },
  };
}

async function fileInput(api: UploadApi, bytes: Uint8Array, partSize: number): Promise<FileUploadInput> {
  const crypt = await loadCrypto();
  const derived = crypt.kdf_derive(crypt.account_code_parse(await generateCode()));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  return {
    api,
    protocol: protocolThat(),
    crypt,
    dataKey,
    source: sourceOf(bytes),
    name: "same.bin",
    parentId: null,
    destination: "",
    relayUrl: "https://relay.example",
    epochs: 2,
    currentEpoch: 40,
    partSize,
    padding: { rule: "none", unitBytes: 1024 * 1024 },
  };
}

const BYTES = new Uint8Array(3000).map((_, i) => (i * 31) % 251);

test("⛔ the same bytes put in the same place again, after the first upload finished, are a new upload", async () => {
  const dir = isolate();
  try {
    const server = serverThat();
    const input = await fileInput(server.api, BYTES, 1000);
    const first = await uploadFile(input);
    // What `put` does once the list names the file: the records are forgotten.
    await forgetUpload(first.fileKey, first.parts);

    const second = await uploadFile(input);
    assert.notEqual(second.itemId, first.itemId, "the commit answered the OLD file for storage just bought");
    assert.equal(second.resumed, false);
    assert.equal(new Set(server.reserveKeys).size, 6, "every part of each upload was reserved under a key of its own");
    assert.equal(new Set(server.commitKeys).size, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a resume keeps the run it started under — same keys, nothing bought twice", async () => {
  const dir = isolate();
  try {
    const server = serverThat();
    let pushes = 0;
    const input = await fileInput(server.api, BYTES, 1000);
    const failing = {
      ...input,
      protocol: protocolThat({
        async uploadToRelay() {
          pushes += 1;
          throw new Error("relay is down");
        },
      }),
    };
    await assert.rejects(uploadFile(failing));
    assert.equal(pushes, 1);
    const result = await uploadFile(input);
    assert.equal(server.reserveKeys.length, 3, "the part the first run paid for was bought again");
    const runs = new Set<string | undefined>();
    for (let index = 0; index < result.parts; index += 1) {
      runs.add((await readReservationRecord(partKey(result.fileKey, index)))?.runId);
    }
    assert.equal(runs.size, 1, "the resume wrote its parts under a run of its own");
    assert.equal(result.itemId, "item-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A record as a version without run ids wrote it: no `runId`, and not yet reserved. */
function legacyRecord(): Reservation {
  return {
    attempt: 0,
    blobId: `blob-${"0".repeat(16)}`,
    nonceB64: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
    rootHashB64: "AQ",
    relayUrl: "https://relay.example",
    epochs: 2,
    sealedLen: SEALED.length,
    plaintextLen: 4,
    partPlaintextLen: 4,
    partIndex: 0,
    partTotal: 1,
    dekWrapped: "ZGVr",
    contentHashCt: "aGFzaA",
    name: "notes.txt",
    parentId: null,
  };
}

test("⛔ a record an earlier version wrote keeps that version's keys, for the reservation and the commit", async () => {
  const dir = isolate();
  try {
    await writeReservation("k-old", legacyRecord(), SEALED);
    await writeItemRecord("k-old", { attempt: 0 });
    const { api, calls } = apiThat();
    await uploadOnePart(inputFor(api, protocolThat(), "k-old"));
    assert.equal(calls.lastReserveKey, "nmts-cli-k-old-0", "a paid reservation under the old key would be bought again");
    assert.equal(calls.lastIdempotencyKey, "nmts-cli-commit-k-old-0");
    assert.equal((await readReservationRecord("k-old"))?.runId, undefined, "the record was given a run id it was not reserved under");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a committed record from ANOTHER upload of the file is not this upload's item", async () => {
  const dir = isolate();
  try {
    await writeItemRecord("k-stale", { attempt: 0, runId: "run-0", itemId: "item-old" });
    const { api, calls } = apiThat();
    const result = await uploadOnePart(inputFor(api, protocolThat(), "k-stale"));
    assert.equal(result.itemId, "item-1");
    assert.equal(calls.createItem, 1);
    assert.equal((await readItemRecord("k-stale"))?.runId, "run-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a part another sealing of the file wrote down is refused, not resumed", async () => {
  const dir = isolate();
  try {
    await writeReservation("k-other", { ...legacyRecord(), runId: "run-9", dekWrapped: "b3RoZXI", ledgerId: 5 }, SEALED);
    const { api, calls } = apiThat();
    const failure = await buyAndPushPart(inputFor(api, protocolThat(), "k-other")).then(() => null, (error: unknown) => error);
    assert.ok(failure instanceof UploadError);
    assert.equal(failure.code, UPLOAD_CONFLICT);
    assert.deepEqual([calls.reserve, calls.status, calls.uploaded], [0, 0, 0], "nothing of that part was touched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ two runs of the same file in one process: the second waits, and neither buys twice", async () => {
  const dir = isolate();
  try {
    const server = serverThat();
    const input = await fileInput(server.api, BYTES, 1000);
    const [a, b] = await Promise.all([uploadFile(input), uploadFile(input)]);
    assert.equal(a.itemId, b.itemId, "two items were made out of one put");
    assert.equal(a.entry.dekWrapped, b.entry.dekWrapped, "the two runs sealed under two different keys");
    assert.equal(server.reserveKeys.length, 3, "a part was reserved twice");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a part record overwritten by another process before the commit stops the commit", async () => {
  const dir = isolate();
  try {
    const server = serverThat();
    const input = await fileInput(server.api, BYTES, 1000);
    // The file key is worked out inside the upload, so a finished one names it first.
    const probe = await uploadFile(input);
    await forgetUpload(probe.fileKey, probe.parts);
    const first = partKey(probe.fileKey, 0);
    let pushes = 0;
    const racing = {
      ...input,
      protocol: protocolThat({
        async uploadToRelay() {
          pushes += 1;
          // Another process writes its own record over part 0 while this one is on part 2.
          const theirs = pushes === 3 ? await readReservationRecord(first) : null;
          if (theirs !== null) await writeReservation(first, { ...theirs, dekWrapped: "b3RoZXI" }, SEALED);
          return { signers: [0], serialized_message_b64: "bQ", signature_b64: "cw" };
        },
      }),
    };
    const failure = await uploadFile(racing).then(() => null, (error: unknown) => error);
    assert.ok(failure instanceof UploadError, "a file made of two sealings was committed");
    assert.equal(failure.code, UPLOAD_CONFLICT);
    assert.equal(server.commitKeys.length, 1, "only the probe committed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tail of a finished upload whose records were half forgotten is not resumed", async () => {
  const dir = isolate();
  try {
    const server = serverThat();
    const input = await fileInput(server.api, BYTES, 1000);
    const first = await uploadFile(input);
    // Forgotten in the old order, and stopped half way: the file's record and part 0 are gone.
    await clearItemRecord(first.fileKey);
    await clearReservation(partKey(first.fileKey, 0));

    const second = await uploadFile(input);
    assert.notEqual(second.itemId, first.itemId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
