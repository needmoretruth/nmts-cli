// The three defects an adversarial review found on 2026-08-23, and the shape of each fix.
//
// ⛔ ALL THREE WERE THE SAME MISTAKE seen from different angles: the reservation record identifies
//    the file by its PLAINTEXT, but everything the reservation actually bought is a function of ONE
//    PARTICULAR SEALING of it. Sealing is non-deterministic, and `put` re-sealed on every run.
//    Every test here fails against the code as it was written.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readReservation } from "../src/upload-store.ts";
import {
  apiThat,
  BLOB_OF_SEALED,
  inputFor,
  isolate,
  protocolThat,
  SEALED,
  uploadOnePart,
  type Pushed,
} from "./upload-fixture.ts";

test("⛔ a resume pushes the bytes the reservation BOUGHT, not a fresh sealing of the same file", async () => {
  const dir = isolate();
  try {
    // Run one: the storage is bought, the relay refuses, the record survives.
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
          "resume-bytes",
        ),
      ),
    );
    const bought = readReservation("resume-bytes")?.record.blobId;
    assert.equal(bought, BLOB_OF_SEALED);

    // Run two: a caller that re-sealed would arrive with DIFFERENT bytes. The stored ones must win.
    const reSealed = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    assert.notDeepEqual(Array.from(reSealed), Array.from(SEALED), "the premise of this test");
    const pushed: { last: Pushed | null } = { last: null };
    const second = apiThat();
    const input = { ...inputFor(second.api, protocolThat({}, pushed), "resume-bytes"), sealed: reSealed };
    await uploadOnePart(input);

    assert.deepEqual(
      Array.from(pushed.last?.bytes ?? []),
      Array.from(SEALED),
      "the relay was given the caller's bytes instead of the ones that were paid for",
    );
    assert.equal(pushed.last?.blobId, bought);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a second run does not overwrite the recorded key with its own", async () => {
  // ⛔ WHY THIS IS THE RECORD AND NOT THE RETURN VALUE. The bytes on the network were sealed under
  //    one file key; a list entry naming any other key is a file that is paid for, present,
  //    correctly named and impossible to open. The record is where that key survives a restart, so
  //    a resumed run arriving with a freshly wrapped one must not be able to replace it.
  //    `upload-file.test.ts` proves the other half — that the entry handed back comes from here.
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
          "resume-entry",
        ),
      ),
    );

    // A second run arrives with a freshly wrapped key — what re-sealing produces.
    const second = apiThat();
    const input = inputFor(second.api, protocolThat(), "resume-entry");
    await uploadOnePart({
      ...input,
      entry: { ...input.entry, dekWrapped: "AAAA-a-different-wrapped-key", contentHashCt: "AAAA-different" },
    });

    const record = readReservation("resume-entry")?.record;
    assert.equal(
      record?.dekWrapped,
      "ZGVr",
      "the record would have been given a key that does not open the stored bytes",
    );
    assert.equal(record?.contentHashCt, "aGFzaA");
    assert.equal(record?.name, "notes.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a resume goes back to the relay that was TIPPED, not to whatever is configured now", async () => {
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
          "resume-relay",
        ),
      ),
    );
    assert.equal(readReservation("resume-relay")?.record.relayUrl, "https://relay.example");

    const steps: string[] = [];
    const second = apiThat();
    await uploadOnePart({
      ...inputFor(second.api, protocolThat(), "resume-relay"),
      // The environment changed between runs — a second relay that was never paid a tip.
      relayUrl: "https://somewhere-else.example",
      onStep: (step) => {
        if (step.step === "uploading") steps.push(step.relayUrl);
      },
    });
    assert.deepEqual(
      steps,
      ["https://relay.example"],
      "the bytes went to a relay that was never tipped for them",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the record survives a crash mid-write — it is renamed over, never truncated in place", async () => {
  const dir = isolate();
  try {
    const { api } = apiThat();
    await uploadOnePart(inputFor(api, protocolThat(), "atomic"));
    // Nothing is left behind by the rename, and what is there parses.
    const { readdirSync } = await import("node:fs");
    const leftovers = readdirSync(join(dir, "uploads")).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "a scratch file was left behind");
    assert.notEqual(readReservation("atomic"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
