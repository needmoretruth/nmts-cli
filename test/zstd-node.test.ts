// The zstd encoder this program hands to the file-list codec (NCF-3 §6.3.4, flag 0x02).
//
// ⛔ THE ROUND TRIP GOES THROUGH THE SHARED CODEC, not through `zlib` twice. What matters is not
//    that Node can compress — it is that a document this program writes carries the flag the format
//    names and comes back as the same entries, because the other half of the product reads it.
//
// ⛔ AND THE BOUND IS TESTED FROM THE OUTSIDE. A decompressor that quietly returned a SHORTER list
//    would be the one failure this format may never have, so the assertion is that a frame claiming
//    more than the caller allows is REFUSED — never truncated to fit.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { forgetNodeZstd, registerNodeZstd } from "../src/zstd-node.ts";
import {
  decodeChunk,
  encodeChunk,
  FILE_LIST_VERSION_CHUNKED,
  FLAG_ZSTD,
} from "../src/shared/lib/drive/manifest-chunks.ts";
import { zstdCodec, ZSTD_LEVEL } from "../src/shared/lib/drive/zstd.ts";
import { entry } from "./fake-drive.ts";

test("a chunk written by this program says zstd, and comes back as the entries it went in as", async () => {
  registerNodeZstd();
  const items = [
    entry({ id: "a", name: "budget.xlsx" }),
    entry({ id: "b", name: "notes.md", parentId: null }),
    entry({ id: "c", name: "photo.jpg", size: 4096 }),
  ];
  const body = await encodeChunk({ v: FILE_LIST_VERSION_CHUNKED, seq: 12, items });
  assert.equal(body[0], FLAG_ZSTD, "the flag byte does not say zstd — this build wrote gzip or raw");

  const back = await decodeChunk(body);
  assert.equal(back.seq, 12);
  assert.deepEqual(
    back.items.map((e) => e.name),
    ["budget.xlsx", "notes.md", "photo.jpg"],
  );
});

test("⛔ a frame that claims more than the caller allows is refused, not cut down to size", async () => {
  registerNodeZstd();
  const codec = zstdCodec();
  assert.ok(codec !== null, "nothing registered an encoder");

  const plain = new TextEncoder().encode("the same sentence over and over. ".repeat(3000));
  const frame = await codec.compress(plain, ZSTD_LEVEL);
  assert.ok(frame.length < plain.length, "the encoder made it no smaller");

  const refused = await Promise.resolve(codec.decompress(frame, 1000)).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(refused instanceof Error, "a frame far over the bound was expanded anyway");

  // ⛔ And the same frame inside its bound still opens. Without this the test above would pass for
  //    an encoder that refuses everything.
  const out = await codec.decompress(frame, plain.length);
  assert.equal(out.length, plain.length);
  assert.deepEqual([...out.subarray(0, 33)], [...plain.subarray(0, 33)]);
});

test("a build with no encoder still writes a chunk every reader can open", async () => {
  forgetNodeZstd();
  try {
    const body = await encodeChunk({
      v: FILE_LIST_VERSION_CHUNKED,
      seq: 1,
      items: [entry({ id: "a", name: "a.txt" })],
    });
    assert.notEqual(body[0], FLAG_ZSTD, "it wrote zstd with no encoder registered");
    assert.deepEqual(
      (await decodeChunk(body)).items.map((e) => e.name),
      ["a.txt"],
    );
  } finally {
    registerNodeZstd();
  }
});
