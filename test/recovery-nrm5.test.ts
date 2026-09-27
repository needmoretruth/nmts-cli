// This tool's recovery-list writer, held to the NRM-5 sample the Rust reader and the browser writer
// are held to: the same items in give the same document out, and every Filecoin part a reader would
// refuse is refused here instead of written.
//
// ⚠ THE SAMPLE LIVES IN THE NMTS REPOSITORY (`crypto/tests/vectors/`), not in this package, so this
//   file skips where that folder is absent — a copy of this package on its own has no sample to hold.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildRecoveryListDoc, type ManifestItemInput, type ManifestPartInput } from "../src/recovery-map.ts";

const SAMPLE = join(import.meta.dirname, "..", "..", "crypto", "tests", "vectors", "nrm5-sample.json");
const skip = existsSync(SAMPLE) ? false : "the shared sample lives in the NMTS repository";

interface SampleItem {
  id: string;
  name: string;
  path: string;
  size: number;
  dek: string;
  content_hash?: string;
  parts: ManifestPartInput[];
}

function load(): { want: Record<string, unknown>; items: ManifestItemInput[]; head: { seq: number; prev: string | null; at: string; account: string } } {
  const { _comment: _, ...want } = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const items = (want["items"] as SampleItem[]).map((it) => ({
    id: it.id,
    name: it.name,
    path: it.path,
    size: it.size,
    dek: it.dek,
    ...(it.content_hash === undefined ? {} : { contentHash: it.content_hash }),
    parts: it.parts,
  }));
  return { want, items, head: { seq: Number(want["seq"]), prev: String(want["prev_manifest_blob_id"]), at: String(want["generated_at"]), account: String(want["account_id"]) } };
}

function build(items: readonly ManifestItemInput[], head: ReturnType<typeof load>["head"]) {
  return buildRecoveryListDoc({ seq: head.seq, prevBlobId: head.prev, generatedAt: head.at, accountId: head.account, items });
}

test("the NRM-5 sample's items come out as the NRM-5 sample, declared v5", { skip }, () => {
  const { want, items, head } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(build(items, head))), want);
  // Without its Filecoin items the same list is not raised to v5.
  assert.notEqual(build(items.filter((it) => it.parts.every((p) => p.network !== "filecoin")), head).v, 5);
});

test("every Filecoin part a reader refuses is refused by the writer", { skip }, () => {
  const { items, head } = load();
  const heavy = items.find((it) => it.parts[0]?.network === "filecoin");
  assert.ok(heavy !== undefined);
  const first = heavy.parts[0];
  assert.ok(first !== undefined && first.copies !== undefined);
  const copy = first.copies[0];
  assert.ok(copy !== undefined);
  const withPart = (part: ManifestPartInput, quilted = false): ManifestItemInput[] => [
    { ...heavy, parts: [part], ...(quilted ? { quilt: { quilt_blob_id: "q", patch_id: "p" } } : {}) },
  ];
  const cases: [string, ManifestItemInput[]][] = [
    ["walrus with copies", withPart({ ...first, network: "walrus" })],
    ["no chain", withPart({ ...first, chain: undefined })],
    ["13 copies", withPart({ ...first, copies: Array.from({ length: 13 }, () => copy) })],
    ["not a PieceCID", withPart({ ...first, blob_id: "blobWalrus" })],
    ["leading zero", withPart({ ...first, copies: [{ ...copy, piece_id: "01" }] })],
    ["wrong address", withPart({ ...first, copies: [{ ...copy, retrieval_url: "https://x.example/other" }] })],
    ["in a quilt", withPart(first, true)],
  ];
  for (const [what, list] of cases) assert.throws(() => build(list, head), /the part at position 0/, what);
});
