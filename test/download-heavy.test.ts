// A network-1 (NMTS Heavy) part is read from its copies, never from a Walrus aggregator.
//
// ⛔ THE FETCH IS INJECTED THROUGH `useReach` — the same door a caller's proxy uses — so the test
//    also proves a Heavy read goes through it rather than round it.

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { asParts, fetchPart } from "../src/download-part.ts";
import { forgetReach, useReach } from "../src/reach.ts";

afterEach(() => forgetReach());

const PIECE = "bafkzcibcaapc5vqvdtwpobrgygptm2qoktlo7ms6vmt3pjxfbrryptvhvvqwlly";
const copy = (host: string, provider: string) => ({
  provider_id: provider,
  data_set_id: "12",
  piece_id: "3",
  retrieval_url: `https://${host}/piece/${PIECE}`,
});

test("a network-1 part comes from the first copy that serves it, at any https company", async () => {
  const asked: string[] = [];
  useReach({
    fetch: async (input) => {
      const url = String(input);
      asked.push(url);
      if (url.includes("down.example")) return new Response("no", { status: 502 });
      return new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 });
    },
  });
  const [part] = asParts({
    size: 5,
    parts: [{ part_index: 0, storage_kind: 0, network: 1, blob_id: PIECE, copies: [copy("down.example", "4"), copy("up.example", "9")] }],
  }).parts;
  assert.ok(part !== undefined);
  assert.equal(part.copies?.length, 2);
  const bytes = await fetchPart(part, "testnet", undefined);
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
  assert.deepEqual(asked, [copy("down.example", "4").retrieval_url, copy("up.example", "9").retrieval_url]);
});

test("a range is cut to what was asked even when the company sends the whole part", async () => {
  useReach({ fetch: async () => new Response(new Uint8Array(100).map((_, i) => i), { status: 200 }) });
  const part = { part_index: 0, storage_kind: 0, network: 1, blob_id: PIECE, copies: [copy("a.example", "4")] };
  const head = await fetchPart(part, "testnet", { range: { start: 0, end: 72 } });
  assert.equal(head.length, 72);
  assert.equal(head[71], 71);
});

test("a network-1 part with no readable copy is refused, not asked of Walrus", async () => {
  useReach({ fetch: async () => assert.fail("nothing may be fetched") });
  const [part] = asParts({ size: 5, parts: [{ part_index: 0, storage_kind: 0, network: 1, blob_id: PIECE, copies: [{ provider_id: 4 }] }] }).parts;
  assert.ok(part !== undefined && part.copies === undefined);
  await assert.rejects(fetchPart(part, "testnet", undefined), /no recorded copies/);
});
