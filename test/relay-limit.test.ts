// The command's part sizes against the storage network's upload relay.
//
// ⛔ THE RELAY REFUSES A BODY OVER 1 GiB AFTER THE REGISTER IS PAID (measured 413 on the testnet relay,
//    2026-11-11). The shared module derives the largest part from the relay limit and the NCF-3
//    envelope; this file holds the command's own sealing constants to that module, and proves the
//    default and the refusals use it. The SDK quotes through `planAndPrice`, so it is covered here too.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { DEFAULT_PART_BYTES, NCF3_SHAPE, sealedLenFor } from "../src/seal.ts";
import {
  MAX_PART_SIZE_BYTES,
  NCF3_PART_SHAPE,
  PADDING_UNIT_BYTES,
  partFitsRelay,
  RELAY_BODY_LIMIT_BYTES,
} from "../src/shared/lib/upload/relay-limit.ts";
import { CREDIT_BYTES, partSizeFor, planAndPrice } from "../src/upload-price.ts";

const MIB = 2 ** 20;

test("the shared relay arithmetic uses this tool's own sealing shape and billing unit", () => {
  assert.deepEqual({ ...NCF3_SHAPE }, NCF3_PART_SHAPE);
  assert.equal(PADDING_UNIT_BYTES, CREDIT_BYTES);
  assert.equal(sealedLenFor(2 ** 30), 1_073_745_992);
  assert.ok(sealedLenFor(2 ** 30) > RELAY_BODY_LIMIT_BYTES);
});

test("the default part size fits the relay, padded final part included", () => {
  assert.ok(partFitsRelay(DEFAULT_PART_BYTES));
  for (const rule of ["padme", "pow2", "none"] as const) {
    const { sealFor, plan } = planAndPrice(DEFAULT_PART_BYTES * 3 - 12_345, DEFAULT_PART_BYTES, rule);
    for (const range of plan) assert.ok(sealedLenFor(sealFor(range)) <= RELAY_BODY_LIMIT_BYTES);
  }
});

test("--part-size refuses anything the relay cannot carry and accepts the largest that fits", () => {
  assert.equal(partSizeFor(`${MAX_PART_SIZE_BYTES / MIB}MiB`), 512 * MIB);
  for (const asked of ["1GiB", "513MiB", String(2 ** 30)]) {
    assert.throws(() => partSizeFor(asked), (e: unknown) => e instanceof NmtsError && e.exitCode === 2);
  }
});

test("pricing refuses an oversized part before it plans anything — the SDK's door", () => {
  assert.throws(() => planAndPrice(5 * 2 ** 30, 2 ** 30, "padme"), /upload relay/);
  assert.equal(planAndPrice(5 * 2 ** 30, 512 * MIB, "padme").plan.length, 10);
});
