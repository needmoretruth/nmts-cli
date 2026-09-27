// An empty file: priced, sealed, bought, committed — and read back as nothing, checked.
//
// ⛔ WHY IT IS A FILE. S3 clients make empty objects routinely, and NCF-3 seals zero bytes as one
//    empty final chunk. What these tests hold is that the whole path takes one, under both the rule
//    that rounds it up and the one that stores exact sizes, and that the download path opens it.

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fromBase64Url } from "../src/bytes.ts";
import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import { openPart } from "../src/download-part.ts";
import { NCF3_SHAPE } from "../src/seal.ts";
import type { PaddingRule } from "../src/shared/lib/crypto/size-padding.ts";
import { uploadFile, type PlaintextSource } from "../src/upload-file.ts";
import { planAndPrice } from "../src/upload-price.ts";
import { measureLocal } from "../src/upload-price-node.ts";
import { generateCode } from "./helpers.ts";
import { apiThat, isolate, protocolThat } from "./upload-fixture.ts";

const NOTHING: PlaintextSource = {
  size: 0,
  async *read() {
    // Nothing to hand out.
  },
};

test("an empty file on this machine measures as zero rather than being refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-empty-"));
  try {
    const path = join(dir, "empty.txt");
    writeFileSync(path, new Uint8Array(0));
    assert.equal(measureLocal(path), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty file is one part, priced as the server prices its sealed bytes", () => {
  const exact = planAndPrice(0, 64 * 2 ** 20, "none");
  assert.equal(exact.plan.length, 1);
  assert.equal(exact.sealedBytes, NCF3_SHAPE.headerLen + NCF3_SHAPE.tagLen, "a header and one empty chunk");
  assert.equal(exact.credits, 1);
  assert.equal(planAndPrice(0, 64 * 2 ** 20, "padme").credits, 1, "rounding up stays inside the credit it costs");
});

for (const rule of ["none", "padme"] satisfies PaddingRule[]) {
  test(`[${rule}] an empty file is sealed, bought, committed, and opens as nothing`, async () => {
    const dir = isolate();
    try {
      const crypt = await loadCrypto();
      const derived = crypt.kdf_derive(crypt.account_code_parse(await generateCode()));
      const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
      derived.fill(0);
      const pushed: Uint8Array[] = [];
      const protocol = protocolThat({
        async uploadToRelay({ bytes }) {
          pushed.push(bytes);
          return { signers: [0], serialized_message_b64: "bQ", signature_b64: "cw" };
        },
      });
      const { api, calls } = apiThat();
      const result = await uploadFile({
        api,
        protocol,
        crypt,
        dataKey,
        source: NOTHING,
        name: "empty.txt",
        parentId: null,
        destination: "",
        relayUrl: "https://relay.example",
        epochs: 2,
        currentEpoch: 40,
        partSize: 64 * 2 ** 20,
        padding: { rule, unitBytes: 1024 * 1024 },
      });
      assert.equal(result.entry.plaintextLen, 0);
      assert.deepEqual([calls.reserve, calls.uploaded, calls.createItem], [1, 1, 1]);
      const stored = pushed[0];
      assert.ok(stored !== undefined && stored.length >= NCF3_SHAPE.headerLen + NCF3_SHAPE.tagLen);

      // Read back the way `nmts get` reads: one part, the last, with nothing of the file left.
      const dek = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.dekWrap), fromBase64Url(result.entry.dekWrapped));
      const emitted: number[] = [];
      const part = { part_index: 0, storage_kind: 0, blob_id: "b" };
      const kept = await openPart(crypt, dek, part, stored, { index: 0, total: 1 }, 0, async (body) => void emitted.push(body.length));
      assert.equal(kept, 0);
      assert.equal(emitted.reduce((a, b) => a + b, 0), 0);
      dek.fill(0);
      dataKey.fill(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
