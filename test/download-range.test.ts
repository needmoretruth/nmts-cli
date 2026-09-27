// A range of a file costs the parts it falls in — not every part before it.
//
// ⛔ WHAT IS MEASURED IS THE STORAGE NETWORK'S BYTES. The fake aggregator counts every byte it hands
//    out, honouring `Range` as the real ones do, so a reader that went back to the file's first byte
//    for a late range would be visible here as the whole file being served.
//
// ⚠ Parts of 5 MiB, so each holds two of the format's 4 MiB chunks and a range can stop inside one.

import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { after, before, test } from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";

import { fromBase64Url } from "../src/bytes.ts";
import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import { fetchWithKey } from "../src/download.ts";
import { forgetReach, useReach } from "../src/reach.ts";
import { responseSink } from "../src/s3/response-sink.ts";
import { uploadFile, type PlaintextSource } from "../src/upload-file.ts";
import { generateCode } from "./helpers.ts";
import { apiThat, isolate, protocolThat } from "./upload-fixture.ts";

const MIB = 2 ** 20;
const PART = 5 * MIB;
const FILE = new Uint8Array(12 * MIB).map((_, i) => (i * 131 + (i >> 12)) % 251);

const blobs = new Map<string, Uint8Array>();
let order: string[] = [];
let served = 0;
let dek = new Uint8Array(0);
let dir = "";

before(async () => {
  dir = isolate();
  const crypt = await loadCrypto();
  const derived = crypt.kdf_derive(crypt.account_code_parse(await generateCode()));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  const source: PlaintextSource = {
    size: FILE.length,
    async *read(offset, length) {
      yield FILE.subarray(offset, offset + length);
    },
  };
  const protocol = protocolThat({
    async uploadToRelay({ blobId, bytes }) {
      blobs.set(blobId, bytes);
      order.push(blobId);
      return { signers: [0], serialized_message_b64: "bQ", signature_b64: "cw" };
    },
  });
  const result = await uploadFile({
    api: apiThat().api,
    protocol,
    crypt,
    dataKey,
    source,
    name: "big.bin",
    parentId: null,
    destination: "",
    relayUrl: "https://relay.example",
    epochs: 2,
    currentEpoch: 40,
    partSize: PART,
    padding: { rule: "padme", unitBytes: MIB },
  });
  dek = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.dekWrap), fromBase64Url(result.entry.dekWrapped));
  dataKey.fill(0);

  // The NMTS server's part list and the storage network, answered through the caller's `fetch`.
  useReach({
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/parts")) {
        const parts = order.map((blob_id, part_index) => ({ part_index, storage_kind: 0, blob_id }));
        return Response.json({ size: FILE.length, parts });
      }
      const bytes = blobs.get(decodeURIComponent(url.pathname.replace("/v1/blobs/", "")));
      if (bytes === undefined) return new Response(null, { status: 404 });
      const asked = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("range") ?? "");
      const body = asked === null ? bytes : bytes.subarray(Number(asked[1]), Number(asked[2]) + 1);
      served += body.length;
      return new Response(body, { status: asked === null ? 200 : 206 });
    },
  });
});

after(() => {
  forgetReach();
  dek.fill(0);
  rmSync(dir, { recursive: true, force: true });
});

/** One GET of `window` through the real response sink, the way the S3 gateway answers it. */
async function getRange(window: { start: number; end: number } | null): Promise<{ bytes: Uint8Array; failure: unknown }> {
  let failure: unknown = null;
  const server = createServer((_req, res) => {
    const sink = responseSink(res, { headers: {}, window });
    fetchWithKey({
      base: "http://nmts.test",
      apiKey: "key",
      descriptorPath: "/v1/items/i/parts?for=download",
      size: FILE.length,
      dek: dek.slice(),
      expected: sha256(FILE),
      chain: "testnet",
      read: { hosts: ["http://aggregator.test"] },
      sink,
    }).catch(async (error: unknown) => {
      if (sink.windowDelivered()) return;
      failure = error;
      await sink.abandon();
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("no port");
  try {
    // ⚠ A refused read destroys a response whose status already went out, so the client may see
    //   the connection drop rather than a body — both mean the same here, and `failure` says why.
    const bytes = await fetch(`http://127.0.0.1:${address.port}/`)
      .then(async (answer) => new Uint8Array(await answer.arrayBuffer()))
      .catch(() => new Uint8Array(0));
    return { bytes, failure };
  } finally {
    server.close();
  }
}

test("⛔ a range in the last part reads the headers before it, not the parts", async () => {
  served = 0;
  const start = 11 * MIB;
  const { bytes, failure } = await getRange({ start, end: start + 99 });
  assert.equal(failure, null);
  assert.deepEqual(bytes, FILE.subarray(start, start + 100));
  // Three headers — the two parts left out and the one read — and the part the range is in.
  const lastPart = blobs.get(order[2] ?? "")?.length ?? 0;
  assert.ok(served <= lastPart + 3 * 72, `served ${served} bytes for a 100-byte range of a ${FILE.length}-byte file`);
});

test("a range inside the first chunk of a part stops after that chunk", async () => {
  served = 0;
  const start = PART + 10;
  const { bytes } = await getRange({ start, end: start + 999 });
  assert.deepEqual(bytes, FILE.subarray(start, start + 1000));
  assert.ok(served < 72 + 4 * MIB + 16 + 72 + 1000, `served ${served}`);
});

test("a range across two parts, and one to the file's end, come back exact", async () => {
  const across = await getRange({ start: PART - 50, end: PART + 49 });
  assert.deepEqual(across.bytes, FILE.subarray(PART - 50, PART + 50));
  const tail = await getRange({ start: 7 * MIB, end: FILE.length - 1 });
  assert.equal(tail.failure, null);
  assert.deepEqual(tail.bytes, FILE.subarray(7 * MIB));
  const whole = await getRange(null);
  assert.deepEqual(whole.bytes, FILE, "the whole-file path changed");
});

test("⛔ a part served in another part's place is refused, even though its bytes authenticate", async () => {
  const kept = order;
  order = [kept[1] ?? "", kept[0] ?? "", kept[2] ?? ""];
  try {
    const { failure } = await getRange({ start: 11 * MIB, end: 11 * MIB + 9 });
    assert.ok(failure instanceof Error && /wrong place/.test(failure.message), `answered: ${String(failure)}`);
  } finally {
    order = kept;
  }
});
