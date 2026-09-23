// `nmts put --pay wallet --from <drive path>` — moving a file the account's CREDITS paid for onto
// the wallet's money: read it out, seal it again, buy storage for the new sealing, and leave the old
// file in the trash.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. The run replaces a file in place, which means two things can
//    go wrong silently: the replacement lands somewhere else (a new name, the drive root) and the
//    person has two paid-for copies, or the original is dropped from the list while the server still
//    counts it live. Both are asserted against the list the tool actually wrote and the ids it
//    actually sent.
//
// ⛔ AND THE DRY RUN MUST NOT READ THE FILE. It is a price, and a price that downloaded somebody's
//    file first would spend the storage network's bandwidth to answer arithmetic.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { put } from "../src/commands/put.ts";
import { NmtsError } from "../src/errors.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { bytesState } from "./fake-bytes.ts";
import { collect, entry, folder, startFakeDrive } from "./fake-drive.ts";
import { withWalletAgreed } from "./fake-extend.ts";
import { putWalletOpts, recordingSigners, refuseToSign } from "./fake-put-wallet.ts";
import { sealFile } from "./helpers.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** The ten bytes the stored file holds, and its id in the drive. */
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const ITEM = "old-item";

/**
 * A drive holding one credit-paid file inside a folder, stored where this suite's aggregator is.
 *
 * ⛔ THE FILE IS SEALED THE WAY THE PRODUCT SEALS ONE, so the download is the real one: the key is
 *    wrapped under this account's data key and the whole-file hash is the account's own.
 */
async function servePaidFile(code: string): Promise<void> {
  const sealed = await sealFile(code, [BYTES]);
  const part = sealed.parts[0];
  assert.ok(part !== undefined);
  await drive.serve(code, [
    folder({ id: "F", name: "notes" }),
    entry({
      id: ITEM,
      name: "a.txt",
      parentId: "F",
      size: BYTES.length,
      dekWrapped: sealed.dekWrapped,
      contentHashCt: sealed.contentHashCt,
    }),
  ]);
  drive.parts.set(ITEM, {
    size: BYTES.length,
    parts: [{ part_index: 0, storage_kind: 1, blob_id: part.blobId, network: 0 }],
  });
  bytesState.blobs.set(part.blobId, part.sealed);
}

/** This suite's aggregator is the fake drive itself — `fake-bytes.ts` answers `/v1/blobs/`. */
async function withAggregator(name: string, body: (code: string) => Promise<void>): Promise<void> {
  const before = process.env[AGGREGATOR_ENV_VAR];
  process.env[AGGREGATOR_ENV_VAR] = drive.base;
  try {
    await withWalletAgreed(drive, name, body);
  } finally {
    if (before === undefined) delete process.env[AGGREGATOR_ENV_VAR];
    else process.env[AGGREGATOR_ENV_VAR] = before;
  }
}

test("--from prices the stored file without reading it, and signs nothing", async () => {
  await withAggregator("put-from-dry", async (code) => {
    await servePaidFile(code);
    const out = collect();
    const sign = refuseToSign("a dry run signed");
    assert.equal(await put(undefined, putWalletOpts(drive, out, { from: "notes/a.txt", dryRun: true, sign })), 0);
    const text = out.lines.join("\n");
    // The name and the size come from the sealed list, not from a local file.
    assert.match(text, /^a\.txt {2}10 bytes {2}→ {2}0\.\d+ WAL from the wallet/m);
    assert.match(text, /Nothing was signed and nothing was sent/);
    assert.equal(sign.calls, 0);
    assert.deepEqual(bytesState.trashed, [], "a dry run put something in the trash");
    assert.deepEqual(drive.written, [], "a dry run wrote the file list");
  });
});

test("⛔ the re-upload keeps the name and the folder, and the credit-paid file goes to the trash", async () => {
  await withAggregator("put-from-run", async (code) => {
    await servePaidFile(code);
    const out = collect();
    const sign = recordingSigners();
    assert.equal(await put(undefined, putWalletOpts(drive, out, { from: "notes/a.txt", sign })), 0);
    assert.equal(sign.registered.length, 1, "the wallet did not sign the registration");

    const left = await drive.lastWritten(code);
    const folderId = left.find((e) => e.name === "notes")?.id;
    const live = left.filter((e) => e.deletedAt === undefined && e.kind === 1);
    assert.deepEqual(
      live.map((e) => ({ name: e.name, parentId: e.parentId })),
      [{ name: "a.txt", parentId: folderId ?? null }],
      "the replacement did not take the original's name and folder",
    );
    assert.notEqual(live[0]?.id, ITEM, "the list still names the credit-paid item");
    // ⛔ THE ORIGINAL IS STILL IN THE LIST, IN THE TRASH. Dropping the entry would leave a file the
    //    server still counts as live and nothing can restore.
    assert.ok(
      left.some((e) => e.id === ITEM && e.deletedAt !== undefined),
      "the credit-paid entry was dropped instead of trashed",
    );
    assert.deepEqual(bytesState.trashed, [ITEM], "the server was not told to trash the original");
    const text = out.lines.join("\n");
    assert.match(text, /The file credits paid for is in the trash now/);
    assert.match(text, /erase --release-storage/);
  });
});

test("⛔ --from refuses the options it leaves no room for, and refuses to pay with credits", async () => {
  await withAggregator("put-from-refusals", async (code) => {
    await servePaidFile(code);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ from: "notes/a.txt", name: "other.txt" }, /--name does not apply with --from/],
      [{ from: "notes/a.txt", to: "elsewhere" }, /--to does not apply with --from/],
      [{ from: "notes/a.txt", onCollision: "rename" }, /--on-collision does not apply with --from/],
      [{ from: "notes/nope.txt" }, /nope\.txt/],
      [{ from: "notes" }, /is a folder/],
    ];
    for (const [extra, expected] of cases) {
      await assert.rejects(
        () => put(undefined, putWalletOpts(drive, collect(), { ...extra, sign: refuseToSign("a refusal signed") })),
        (error: unknown) => {
          assert.ok(error instanceof NmtsError, `${JSON.stringify(extra)} threw something else`);
          assert.match(error.message, expected);
          return true;
        },
      );
    }
    // ⛔ AND A LOCAL FILE BESIDE IT IS TWO FILES FOR ONE RUN.
    await assert.rejects(
      () => put("./notes.txt", putWalletOpts(drive, collect(), { from: "notes/a.txt" })),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.match(error.message, /a local file does not apply with --from/);
        return true;
      },
    );
    // Credits buy storage from the treasury, so there is nothing for this to move onto.
    await assert.rejects(
      () => put(undefined, { ...putWalletOpts(drive, collect(), { from: "notes/a.txt" }), pay: "credits" }),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.match(error.message, /--from only applies with --pay wallet/);
        return true;
      },
    );
    assert.deepEqual(bytesState.trashed, [], "a refused run touched the trash");
  });
});
