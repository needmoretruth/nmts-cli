// The file list as an INDEX plus CHUNKS (NCF-3 §6.3) — reading one, and writing one.
//
// ⛔ THE PROPERTY THIS FORMAT EXISTS FOR IS TESTED WITH REAL SIZES. "An edit uploads one piece" is
//    only true while the packer keeps the pieces apart, and it keeps them apart by their PLAINTEXT
//    SIZE: chunks that fall under half the bound are merged back into one. So the fixture below
//    builds two chunks that are genuinely over half, and the assertion is a count of chunk writes.
//    A fixture of three tiny chunks would merge into one and the test would pass for a tool that
//    rewrites the whole list every time — which is the defect it is here to catch.
//
// ⛔ AND A CHUNK THAT DOES NOT MATCH ITS NAME IS A REFUSAL, never a shorter drive. That is §6.1's
//    rule carried into a list made of parts, and it is the one failure this format may not have.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { applyManyToList, applyToList } from "../src/manifest-write.ts";
import { readFileList } from "../src/manifest.ts";
import { NmtsError } from "../src/errors.ts";
import { FILE_LIST_VERSION_CHUNKED } from "../src/shared/lib/drive/manifest-chunks.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { identityOf } from "../src/account.ts";
import { KEY } from "./fake-drive.ts";
import { nameOf } from "./fake-chunks.ts";
import { openFileListDoc } from "./helpers.ts";
import { startFakeItems, withAccount } from "./fake-items.ts";

const fake = await startFakeItems();
after(() => fake.close());

/** One entry, with the fields these tests do not care about filled in. */
function item(id: string, name: string): ManifestEntry {
  return { id, name, parentId: null, kind: 1, size: 10, createdAt: 1, updatedAt: 1 };
}

/**
 * A run of entries big enough that the packer will not merge their chunk into its neighbour.
 *
 * ⚠ The bound is on the PLAINTEXT of a chunk, and merging happens under half of it — so 550
 *   entries of about 3,960 bytes each (≈ 2.18 MB) sit above that line with room to spare and well
 *   under the 3.9 MB ceiling that would split them.
 */
function bulky(prefix: string, count = 550): ManifestEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const n = `${prefix}${String(i).padStart(4, "0")}`;
    return item(n, `${n}-${"x".repeat(3900)}`);
  });
}

const session = (code: string) => ({
  server: fake.base,
  apiKey: KEY,
  code,
  accountId: "",
});

async function inputFor(code: string): Promise<ReturnType<typeof session>> {
  return { ...session(code), accountId: (await identityOf(code)).accountId };
}

/** How many chunk writes the tool has made so far. */
function chunkWrites(): number {
  return fake.calls.filter((c) => c.startsWith("PUT /v1/manifest/chunks/")).length;
}

test("a list in three chunks opens as one list, in the order the index names them", async () => {
  await withAccount(fake, "chunks-read", async (code) => {
    await fake.serveChunked(code, [
      [item("a", "apples.txt")],
      [item("b", "bananas.txt"), item("b2", "berries.txt")],
      [item("c", "cherries.txt")],
    ]);
    const id = (await identityOf(code)).accountId;

    const list = await readFileList(fake.base, KEY, code, id);
    assert.equal(list.version, FILE_LIST_VERSION_CHUNKED);
    assert.equal(list.chunks?.length, 3, "it did not keep the chunks it read");
    assert.deepEqual(
      list.manifest?.entries.map((e) => e.name),
      ["apples.txt", "bananas.txt", "berries.txt", "cherries.txt"],
    );
  });
});

test("a chunk read a second time comes from this machine, not from the server", async () => {
  await withAccount(fake, "chunks-cache", async (code) => {
    await fake.serveChunked(code, [[item("a", "a.txt")], [item("b", "b.txt")]]);
    const id = (await identityOf(code)).accountId;

    await readFileList(fake.base, KEY, code, id);
    const fetched = fake.calls.filter((c) => c.startsWith("GET /v1/manifest/chunks/")).length;
    assert.equal(fetched, 2, `the first read did not fetch both chunks — ${fake.calls.join(" · ")}`);

    await readFileList(fake.base, KEY, code, id);
    const again = fake.calls.filter((c) => c.startsWith("GET /v1/manifest/chunks/")).length;
    assert.equal(again, 2, "the second read fetched a chunk it already held, by name");
  });
});

test("⛔ a chunk whose bytes are not the ones the index named is refused, never a shorter list", async () => {
  await withAccount(fake, "chunks-tamper", async (code) => {
    await fake.serveChunked(code, [[item("a", "a.txt")], [item("b", "b.txt")]]);
    const id = (await identityOf(code)).accountId;

    // The server hands back another chunk of this same account under the first one's name — the
    // swap the index's hash exists to catch.
    const names = [...fake.chunks.store.keys()];
    const [first, second] = names;
    const other = second === undefined ? "" : (fake.chunks.store.get(second) ?? "");
    assert.ok(first !== undefined && other !== "", "the harness published no chunks");
    fake.chunks.store.set(first, other);

    const failure = await readFileList(fake.base, KEY, code, id).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, `it read the tampered list — ${String(failure)}`);
    assert.match(failure.message, /does not match the name/);
  });
});

test("a rename on a chunked list writes ONE chunk, and an index naming them all", async () => {
  await withAccount(fake, "chunks-one-write", async (code) => {
    const left = bulky("a");
    const right = bulky("b");
    await fake.serveChunked(code, [left, right]);
    const input = await inputFor(code);
    const before = chunkWrites();

    const target = right[300];
    assert.ok(target !== undefined);
    const result = await applyToList(input, () => ({
      op: "rename",
      id: target.id,
      // Same folder and the same sort position, so this is a rewrite of one chunk rather than a
      // removal from one and an addition to another.
      name: `${target.id}-${"y".repeat(3900)}`,
      at: 2,
    }));

    assert.equal(result.changed, true);
    assert.equal(chunkWrites() - before, 1, "a one-file rename did not cost exactly one chunk");
    const write = fake.chunks.indexWrites.at(-1);
    assert.equal(write?.refs.length, 2, "the index did not name every chunk it is made of");
    assert.deepEqual(
      [...(write?.refs ?? [])].sort(),
      [...new Set(write?.refs ?? [])].sort(),
      "the index named a chunk twice",
    );

    const back = await readFileList(fake.base, KEY, code, input.accountId);
    assert.equal(back.manifest?.entries.length, left.length + right.length);
    assert.ok(
      back.manifest?.entries.some((e) => e.name.endsWith("y".repeat(20))),
      "the rename is not in the list that came back",
    );
  });
});

test("the first save of a one-blob list converts it: chunks first, then an index naming that blob", async () => {
  await withAccount(fake, "chunks-convert", async (code) => {
    await fake.serve(code, [item("a", "a.txt"), item("b", "b.txt")]);
    const oldBlob = fake.servedCt();
    assert.ok(oldBlob !== null);
    const input = await inputFor(code);

    await applyToList(input, () => ({ op: "rename", id: "a", name: "renamed.txt", at: 2 }));

    // ⛔ THE ORDER IS THE POINT. An index naming a chunk the server does not hold would be a
    //    version nobody could open afterwards.
    const chunkAt = fake.calls.findIndex((c) => c.startsWith("PUT /v1/manifest/chunks/"));
    const indexAt = fake.calls.findIndex((c) => c === "PUT /v1/manifest");
    assert.ok(chunkAt >= 0 && indexAt >= 0, `both writes must happen — ${fake.calls.join(" · ")}`);
    assert.ok(chunkAt < indexAt, "the index was written before the chunk it names");

    const written = fake.written.at(-1);
    assert.ok(written !== undefined);
    const doc = await openFileListDoc(code, written);
    assert.equal(doc.v, FILE_LIST_VERSION_CHUNKED, "the save did not convert the account");
    if (doc.v !== FILE_LIST_VERSION_CHUNKED) return;
    assert.equal(doc.index.p, nameOf(oldBlob), "the new index does not name the blob it replaced");
    assert.equal(doc.index.seq, 2);
    assert.equal(doc.index.chunks.length, 1);
  });
});

test("an index the server says names chunks it has not got is answered by writing them again", async () => {
  await withAccount(fake, "chunks-missing", async (code) => {
    await fake.serve(code, [item("a", "a.txt")]);
    const input = await inputFor(code);
    // The server refuses the first index write with the one refusal that has a remedy.
    fake.chunks.refuseMissing = 1;

    const result = await applyToList(input, () => ({ op: "rename", id: "a", name: "b.txt", at: 2 }));

    assert.equal(result.changed, true, "the save gave up on a refusal it is supposed to answer");
    assert.equal(fake.chunks.indexWrites.length, 2, "the index was not sent a second time");
    assert.equal(chunkWrites(), 2, "the chunks were not written again before the retry");
    assert.deepEqual(
      (await fake.lastWritten(code)).map((e) => e.name),
      ["b.txt"],
    );
  });
});

test("a settings change rewrites the index and not one chunk", async () => {
  await withAccount(fake, "chunks-settings", async (code) => {
    // ⚠ The bulky fixture, because two SMALL chunks would be merged into one by the packer and the
    //   save would legitimately rewrite a chunk. What is asserted here is that a settings change
    //   touches no entry — not that the packer never reshapes a list that wants reshaping.
    await fake.serveChunked(code, [bulky("a"), bulky("b")]);
    const input = await inputFor(code);
    const before = chunkWrites();

    const result = await applyManyToList(input, () => [], { paddingMode: "none" });

    assert.equal(result.changed, true);
    assert.equal(chunkWrites() - before, 0, "a settings change rewrote part of the entries");
    assert.equal(fake.chunks.indexWrites.at(-1)?.refs.length, 2, "the index stopped naming a chunk");

    const written = fake.written.at(-1);
    assert.ok(written !== undefined);
    const doc = await openFileListDoc(code, written);
    assert.equal(doc.v === FILE_LIST_VERSION_CHUNKED ? doc.index.settings?.paddingMode : null, "none");
  });
});
