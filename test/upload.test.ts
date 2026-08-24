// The credit-paid upload state machine, driven against fakes.
//
// ⛔ WHAT THESE TESTS ARE ACTUALLY FOR. Every branch below is a place where an interruption can
//    turn into money that bought nothing. The happy path is one test; the rest are about a retry
//    finding the reservation it already paid for instead of making a second one.
//
// The RESUME tests — the ones that came out of an adversarial review — are in
// `upload-resume.test.ts`. The fakes both suites share are in `upload-fixture.ts`.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UploadError } from "../src/upload-wire.ts";
import { readItemRecord, readReservation, reservationKey, clearReservation } from "../src/upload-store.ts";
import { BLOB_OF_SEALED, SEALED, apiThat, inputFor, isolate, protocolThat, uploadOnePart } from "./upload-fixture.ts";

test("the happy path spends once, uploads once and commits once", async () => {
  const dir = isolate();
  try {
    const { api, calls } = apiThat();
    const result = await uploadOnePart(inputFor(api, protocolThat(), "k1"));
    assert.equal(result.itemId, "item-1");
    assert.equal(result.resumed, false);
    assert.deepEqual(
      [calls.reserve, calls.uploaded, calls.createItem],
      [1, 1, 1],
      "each step ran exactly once",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the reservation is written down BEFORE the credits move", async () => {
  const dir = isolate();
  try {
    let recordAtReserveTime: ReturnType<typeof readReservation> = null;
    const { api } = apiThat({
      async reserve(body) {
        // Read from disk at the exact moment the server is being asked to spend.
        recordAtReserveTime = readReservation("k2");
        return {
          ledger_id: 5,
          state: "registered",
          blob_object_id: "0xb",
          register_tx_digest: "0xt",
          credits_spent: 1,
        };
      },
    });
    await uploadOnePart(inputFor(api, protocolThat(), "k2"));
    assert.notEqual(recordAtReserveTime, null, "nothing was on disk when the credits moved");
    assert.equal(recordAtReserveTime?.record.blobId, BLOB_OF_SEALED);
    assert.equal(
      recordAtReserveTime?.record.nonceB64,
      Buffer.from(new Uint8Array(32).fill(2)).toString("base64url"),
      "the tip nonce is what a retry cannot reproduce without — so it is what is stored",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a retry after a paid reserve asks the server instead of buying again", async () => {
  const dir = isolate();
  try {
    // First run: the relay refuses, so the storage is bought and unfilled.
    const first = apiThat();
    await assert.rejects(
      uploadOnePart(
        inputFor(
          first.api,
          protocolThat({
            async uploadToRelay() {
              throw new Error("relay is down");
            },
          }),
          "k3",
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof UploadError);
        assert.equal(error.phase, "uploading");
        assert.equal(error.paid, true, "the money already moved and the message must say so");
        return true;
      },
    );
    assert.equal(first.calls.reserve, 1);

    // Second run: same key, same bytes.
    const second = apiThat();
    const result = await uploadOnePart(inputFor(second.api, protocolThat(), "k3"));
    assert.equal(result.resumed, true);
    assert.equal(second.calls.reserve, 0, "⛔ a second reserve would be a second purchase");
    assert.equal(second.calls.status, 1, "it asked where the paid reservation stands");
    assert.equal(second.calls.uploaded, 1);
    assert.equal(result.itemId, "item-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a retry re-feeds the SAME nonce, so the blob id cannot change under a paid tip", async () => {
  const dir = isolate();
  try {
    const seen: (Uint8Array | undefined)[] = [];
    const watching = protocolThat({
      async computeMetadata({ nonce }) {
        seen.push(nonce);
        return {
          blobId: BLOB_OF_SEALED,
          rootHash: new Uint8Array(32).fill(1),
          nonce: nonce ?? new Uint8Array(32).fill(2),
          blobDigest: new Uint8Array(32).fill(3),
        };
      },
    });
    // Fail at the reserve so the record survives WITHOUT a ledger id — the "interrupted before the
    // money moved" case, which is the one that re-encodes.
    const failing = apiThat({
      async reserve() {
        throw new Error("the server did not answer");
      },
    });
    await assert.rejects(uploadOnePart(inputFor(failing.api, watching, "k4")));
    await uploadOnePart(inputFor(apiThat().api, watching, "k4"));

    assert.equal(seen.length, 2);
    assert.equal(seen[0], undefined, "a first encode lets the engine make the nonce");
    assert.deepEqual(
      Array.from(seen[1] ?? []),
      Array.from(new Uint8Array(32).fill(2)),
      "⛔ the second encode used the stored nonce, not a fresh one",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reservation that is already certified skips the relay entirely", async () => {
  const dir = isolate();
  try {
    const { api, calls } = apiThat({
      async reserve() {
        return { ledger_id: 9, state: "certified", credits_spent: 1 };
      },
    });
    const result = await uploadOnePart(inputFor(api, protocolThat(), "k5"));
    assert.equal(result.itemId, "item-1");
    assert.equal(calls.uploaded, 0, "bytes that are already final are not pushed again");
    assert.equal(calls.createItem, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a dead reservation is KEPT and counted up — clearing it would brick the file forever", async () => {
  // The idempotency key is a pure function of the account, the bytes and the destination, and the
  // server replays a reservation row under its key WHATEVER STATE IT IS IN. A cleared record means
  // the next run rebuilds the same key, is handed the same dead row, is told to start over into
  // it — and this account could never upload this file again unless a byte of it changed.
  const dir = isolate();
  try {
    const first = apiThat();
    await assert.rejects(
      uploadOnePart(
        inputFor(
          first.api,
          protocolThat({
            async uploadToRelay() {
              throw new Error("relay is down");
            },
          }),
          "k6",
        ),
      ),
    );
    assert.equal(readReservation("k6")?.record.attempt, 0);

    const dead = apiThat({
      async status() {
        return { ledger_id: 77, state: "failed" };
      },
    });
    await assert.rejects(uploadOnePart(inputFor(dead.api, protocolThat(), "k6")), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.match(error.message, /failed/);
      return true;
    });
    const after = readReservation("k6");
    assert.notEqual(after, null, "the record is what carries the attempt number");
    assert.equal(after?.record.attempt, 1, "the next reservation asks under a different key");
    assert.equal(after?.record.ledgerId, undefined, "the dead reservation is not carried forward");
    assert.equal(after?.record.registerTxDigest, undefined);

    // …and the next run really does ask for a NEW reservation.
    const fresh = apiThat();
    await uploadOnePart(inputFor(fresh.api, protocolThat(), "k6"));
    assert.equal(fresh.calls.reserve, 1, "it started over rather than resuming into the dead row");
    assert.equal(fresh.calls.lastReserveKey, "nmts-cli-k6-1", "under a key the server has not settled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the record OUTLIVES the commit — the file list has not been written yet", async () => {
  const dir = isolate();
  try {
    const { api } = apiThat();
    const result = await uploadOnePart(inputFor(api, protocolThat(), "k7"));
    const after = readReservation("k7");
    assert.notEqual(after, null, "clearing here would lose a paid, stored, invisible file");
    assert.equal(readItemRecord("k7")?.itemId, result.itemId);

    // A run that finds a committed record does not touch the server at all.
    const again = apiThat();
    const second = await uploadOnePart(inputFor(again.api, protocolThat(), "k7"));
    assert.equal(second.itemId, result.itemId);
    assert.deepEqual([again.calls.reserve, again.calls.status, again.calls.createItem], [0, 0, 0]);

    clearReservation("k7");
    assert.equal(readReservation("k7"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the two idempotency keys are derived from the reservation key, not invented per run", async () => {
  const dir = isolate();
  try {
    const { api, calls } = apiThat();
    await uploadOnePart(inputFor(api, protocolThat(), "k8"));
    assert.equal(calls.lastReserveKey, "nmts-cli-k8-0");
    assert.equal(calls.lastIdempotencyKey, "nmts-cli-commit-k8-0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reservation key is the same for the same account, bytes and destination", () => {
  const dataKey = new Uint8Array(32).fill(7);
  const other = new Uint8Array(32).fill(8);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(reservationKey(dataKey, bytes, "a.bin", ""), reservationKey(dataKey, bytes, "a.bin", ""));
  assert.notEqual(reservationKey(dataKey, bytes, "a.bin", ""), reservationKey(other, bytes, "a.bin", ""));
  assert.notEqual(
    reservationKey(dataKey, bytes, "a.bin", ""),
    reservationKey(dataKey, new Uint8Array([1, 2, 4]), "a.bin", ""),
  );
});

test("⛔ two files with identical content are two uploads, not one", () => {
  // Without this, putting `copy-of-a.bin` would silently resume `a.bin`'s reservation: report
  // success, spend nothing, and write a SECOND list entry pointing at the FIRST file's item.
  const dataKey = new Uint8Array(32).fill(7);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.notEqual(
    reservationKey(dataKey, bytes, "a.bin", ""),
    reservationKey(dataKey, bytes, "copy-of-a.bin", ""),
    "a different name is a different upload",
  );
  assert.notEqual(
    reservationKey(dataKey, bytes, "a.bin", ""),
    reservationKey(dataKey, bytes, "a.bin", "archive"),
    "a different folder is a different upload",
  );
});

test("⛔ the reservation name is not a bare hash of the file's bytes", () => {
  // A directory of plaintext SHA-256s would be matchable against published hash sets — the very
  // exposure that sealing the content hash exists to avoid.
  const bytes = new Uint8Array([1, 2, 3]);
  const bare = Buffer.from(createHash("sha256").update(bytes).digest())
    .toString("base64url")
    .slice(0, 32);
  assert.notEqual(reservationKey(new Uint8Array(32).fill(7), bytes, "a.bin", ""), bare);
});

test("an interrupted run leaves the sealed bytes on disk, and they are the bytes that get pushed", async () => {
  const dir = isolate();
  try {
    const failing = apiThat({
      async uploaded() {
        throw new Error("the server did not answer");
      },
    });
    await assert.rejects(uploadOnePart(inputFor(failing.api, protocolThat(), "k9")));
    const stored = readReservation("k9");
    assert.deepEqual(Array.from(stored?.sealed ?? []), Array.from(SEALED));
    assert.ok(existsSync(join(dir, "uploads", "k9.bin")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

