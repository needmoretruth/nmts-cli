// Fakes for the credit-paid upload, shared by the two upload suites.
//
// ⛔ THE BLOB ID IS A HASH OF THE BYTES, and that is the whole value of this file. An earlier
//    version returned a constant and ignored its `bytes` argument, which made every resume test
//    structurally blind to the one failure the module exists to prevent: pushing bytes that are
//    not the blob the reservation bought. The code had that defect and every test was green.
//    A fake that ignores the input cannot test the code that reads it.

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { grantConsents } from "./helpers.ts";
import { buyAndPushPart } from "../src/upload.ts";
import { commitItem } from "../src/upload-steps.ts";
import { readItemRecord } from "../src/upload-store.ts";
import type { BlobProtocol, UploadApi, UploadInput } from "../src/upload-wire.ts";

/** A config directory per test, so one test's leftover record is never another's resume. */
export function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-upload-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env", "spend");
  return dir;
}

export const SEALED = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
export const BLOB_OF_SEALED = blobIdOf(SEALED);

/** The storage network's id for some bytes, as this fake computes it. */
export function blobIdOf(bytes: Uint8Array): string {
  return `blob-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}

/** What the last relay push was given. The tests that matter most are about exactly this. */
export interface Pushed {
  blobId: string;
  bytes: Uint8Array;
  relayUrl: string | null;
}

export function protocolThat(
  overrides: Partial<BlobProtocol> = {},
  pushed?: { last: Pushed | null; relayUrl?: string },
): BlobProtocol {
  return {
    async computeMetadata({ bytes, nonce }) {
      return {
        blobId: blobIdOf(bytes),
        rootHash: new Uint8Array(32).fill(1),
        nonce: nonce ?? new Uint8Array(32).fill(2),
        blobDigest: new Uint8Array(32).fill(3),
      };
    },
    async uploadToRelay({ blobId, bytes }) {
      // ⛔ The relay REFUSES bytes that are not the blob it was told to expect. That is what a real
      //    relay does, and a fake that accepted anything would let the defect through again.
      const actual = blobIdOf(bytes);
      if (actual !== blobId) {
        throw new Error(`relay refuses: asked for ${blobId} but these bytes are ${actual}`);
      }
      if (pushed) pushed.last = { blobId, bytes, relayUrl: pushed.relayUrl ?? null };
      return { signers: [0, 1], serialized_message_b64: "bQ", signature_b64: "cw" };
    },
    ...overrides,
  };
}

export interface Calls {
  reserve: number;
  status: number;
  uploaded: number;
  createItem: number;
  lastIdempotencyKey: string | null;
  lastReserveKey: string | null;
}

export function apiThat(overrides: Partial<UploadApi> = {}): { api: UploadApi; calls: Calls } {
  const calls: Calls = {
    reserve: 0,
    status: 0,
    uploaded: 0,
    createItem: 0,
    lastIdempotencyKey: null,
    lastReserveKey: null,
  };
  const api: UploadApi = {
    async reserve(body) {
      calls.reserve += 1;
      calls.lastReserveKey = body.idempotency_key;
      return {
        ledger_id: 77,
        state: "registered",
        blob_object_id: "0xblob",
        register_tx_digest: "0xtx",
        credits_spent: 1,
      };
    },
    async status() {
      calls.status += 1;
      return { ledger_id: 77, state: "registered", blob_object_id: "0xblob", register_tx_digest: "0xtx" };
    },
    async uploaded() {
      calls.uploaded += 1;
      return {};
    },
    async createItem(_body, idempotencyKey) {
      calls.createItem += 1;
      calls.lastIdempotencyKey = idempotencyKey;
      return { id: "item-1" };
    },
    ...overrides,
  };
  return { api, calls };
}

export function inputFor(api: UploadApi, protocol: BlobProtocol, key: string): UploadInput {
  return {
    api,
    protocol,
    key,
    sealed: SEALED,
    relayUrl: "https://relay.example",
    epochs: 2,
    currentEpoch: 40,
    part: { index: 0, total: 1, plaintextLen: 4 },
    entry: {
      name: "notes.txt",
      parentId: null,
      plaintextLen: 4,
      dekWrapped: "ZGVr",
      contentHashCt: "aGFzaA",
    },
  };
}

/**
 * Buy, push and commit a file that fits in ONE part — what most of these suites are about.
 *
 * ⛔ IT IS THE REAL PATH, NOT A SIMPLIFICATION. A file in one part is a file whose plan came out
 *    with one range in it; the same two steps run for every part of a large one. Driving them here
 *    is what keeps the branch that almost every upload takes covered by the suites that were
 *    written for it.
 */
export async function uploadOnePart(
  input: UploadInput,
): Promise<{ itemId: string; resumed: boolean; ledgerId: number }> {
  // ⛔ THE SAME SHORT CIRCUIT THE ORCHESTRATOR HAS. A committed file needs nothing from the server,
  //    and asking anyway would be a round trip per part to learn what the record already says.
  const committed = readItemRecord(input.key);
  if (committed?.itemId !== undefined) {
    return { itemId: committed.itemId, resumed: true, ledgerId: 0 };
  }
  const part = await buyAndPushPart(input);
  const itemId = await commitItem(input, input.key, [part]);
  return { itemId, resumed: part.resumed, ledgerId: part.ledgerId };
}
