// ⛔ THE QUESTION THIS ANSWERS. A credit-paid upload has to tell the server the blob id, root hash
//    and tip nonce BEFORE the server buys storage — so the erasure coding has to happen on this
//    machine. Whether that is possible outside a browser was the one thing that decided this
//    tool's implementation language. This test is the standing proof: if it ever stops passing,
//    the whole approach needs rethinking, and that should be loud rather than discovered at
//    assembly time.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG } from "@mysten/walrus";

/** Shard count of the live testnet, supplied so the encode needs no chain read. */
const TESTNET_SHARDS = 1000;

function client(): ReturnType<typeof makeClient> {
  return makeClient();
}

/**
 * ⛔ THE RPC URL IS DELIBERATELY UNREACHABLE. The claim under test is that the encode happens on
 *    this machine; pointing at a real node would let a passing test hide a chain read. With
 *    `numShards` supplied there is nothing to ask, so a client that cannot reach anything must
 *    still produce a blob id — and if a future SDK starts reaching out, these tests fail loudly
 *    instead of quietly becoming network tests.
 */
const UNREACHABLE_RPC = "http://127.0.0.1:1";

function makeClient() {
  return new SuiJsonRpcClient({
    network: "testnet",
    url: UNREACHABLE_RPC,
  }).$extend(walrus({ packageConfig: TESTNET_WALRUS_PACKAGE_CONFIG }));
}

test("⛔ blob metadata is computed on THIS machine, with no browser and no network", async () => {
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;

  const meta = await client().walrus.computeBlobMetadata({ bytes, numShards: TESTNET_SHARDS });

  assert.equal(typeof meta.blobId, "string");
  assert.ok(meta.blobId.length > 0, "no blob id was produced");
  assert.equal(meta.rootHash.length, 32, "root hash is not 32 bytes");
  assert.equal(meta.nonce.length, 32, "tip nonce is not 32 bytes");
});

test("the same bytes and the same nonce reproduce the same id — a resume cannot double-charge", async () => {
  // This is the property the credit rail depends on: on a retry the tool re-derives the identical
  // blob id and digest from the stored nonce, so the server hands back the ORIGINAL reservation
  // instead of selling storage twice.
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const first = await client().walrus.computeBlobMetadata({ bytes, numShards: TESTNET_SHARDS });
  const again = await client().walrus.computeBlobMetadata({
    bytes,
    nonce: first.nonce,
    numShards: TESTNET_SHARDS,
  });
  assert.equal(again.blobId, first.blobId);
  assert.deepEqual(Array.from(again.nonce), Array.from(first.nonce));
});

test("different bytes give a different id", async () => {
  const a = await client().walrus.computeBlobMetadata({
    bytes: new Uint8Array([1, 2, 3]),
    numShards: TESTNET_SHARDS,
  });
  const b = await client().walrus.computeBlobMetadata({
    bytes: new Uint8Array([1, 2, 4]),
    numShards: TESTNET_SHARDS,
  });
  assert.notEqual(a.blobId, b.blobId);
});
