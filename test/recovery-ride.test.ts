// The recovery list riding in a wallet upload (`upload-recovery-patch.ts`, spec 2026-09-20 unit B).
//
// ⛔ THE QUILT IS THE STORAGE NETWORK'S OWN LAYOUT. The protocol here lays it out with the Walrus
//    SDK's real `encodeQuilt`, offline, so the patch indices and the patch id are the ones an
//    aggregator reads — and the patch id is checked against the SDK's own encoder.
//
// ⛔ WHAT RIDES IS OPENED. The list's patch is taken out of what was handed to the encoder and
//    opened with the NMTS key at the format's offsets, and the riding file must be in it under the
//    own-quilt placement that names its patch.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { encodeQuilt } from "@mysten/walrus";

import { identityOf } from "../src/account.ts";
import { toBase64Url } from "../src/bytes.ts";
import { DERIVED, loadCrypto } from "../src/crypto.ts";
import { rideRecoveryList, type RecoveryRide, type RideContext } from "../src/upload-recovery-patch.ts";
import { writeReservation, type Reservation } from "../src/upload-store.ts";
import type { BlobProtocol, PaidPart, UploadInput } from "../src/upload-wire.ts";
import { KEY } from "./fake-drive.ts";
import { authSecretOf, openRecoveryList, sealUnderDataKey, startFakeRecovery, withAccount } from "./fake-recovery.ts";
import { serveThreeFiles } from "./recovery-bytes-fixture.ts";
import { apiThat } from "./upload-fixture.ts";

const fake = await startFakeRecovery();
after(() => fake.close());

const STREAM = new Uint8Array(4000).fill(5);

/** A blob id as the network spells one: 32 bytes, base64url. */
const blobIdOf = (bytes: Uint8Array): string => toBase64Url(createHash("sha256").update(bytes).digest());

interface Spy {
  protocol: BlobProtocol;
  encoded: { contents: Uint8Array; identifier: string }[][];
}

function quiltProtocol(): Spy {
  const encoded: Spy["encoded"] = [];
  const protocol: BlobProtocol = {
    async computeMetadata() {
      throw new Error("the rail is faked here");
    },
    async uploadToRelay() {
      throw new Error("the rail is faked here");
    },
    async encodeQuilt(blobs) {
      encoded.push(blobs.map((b) => ({ contents: b.contents, identifier: b.identifier })));
      const { quilt, index } = encodeQuilt({ blobs: [...blobs], numShards: 1000 });
      return { quilt, patches: index.patches.map((p) => ({ identifier: p.identifier, startIndex: p.startIndex, endIndex: p.endIndex })) };
    },
  };
  return { protocol, encoded };
}

/** A rail that only remembers what it was given, and answers as the wallet rail does. */
function railThat(): { rail: (input: UploadInput) => Promise<PaidPart>; given: Uint8Array[] } {
  const given: Uint8Array[] = [];
  return {
    given,
    rail: async (input) => {
      given.push(input.sealed);
      return { partIndex: 0, ledgerId: null, blobId: blobIdOf(input.sealed), sealedLen: input.sealed.length, resumed: false };
    },
  };
}

async function inputOf(code: string): Promise<UploadInput> {
  return {
    api: apiThat().api,
    protocol: quiltProtocol().protocol,
    runId: "run-ride",
    key: "ride-file~p0",
    sealed: STREAM,
    relayUrl: "https://relay.example",
    epochs: 2,
    depositCredits: 0,
    currentEpoch: 40,
    part: { index: 0, total: 1, plaintextLen: 3900 },
    entry: {
      name: "riding.pdf",
      parentId: "f1",
      plaintextLen: 3900,
      dekWrapped: await sealUnderDataKey(code, "nmts/v3/dek-wrap", new Uint8Array(32).fill(4)),
      contentHashCt: await sealUnderDataKey(code, "nmts/v3/content-hash", new Uint8Array(32).fill(6)),
    },
  };
}

/** The ride as a wallet upload drives it: planned for the part before the price, then round the rail. */
async function rideThrough(
  rail: (input: UploadInput) => Promise<PaidPart>,
  ctx: RideContext,
  input: UploadInput,
): Promise<{ ride: RecoveryRide; planned: number | null; paid: PaidPart }> {
  const ride = rideRecoveryList(ctx);
  const { key, sealed, entry, part } = input;
  const planned = await ride.plan({ partKey: key, sealedLen: sealed.length, name: entry.name, parentId: entry.parentId, size: entry.plaintextLen, streamPlaintextLen: part.plaintextLen });
  return { ride, planned, paid: await ride.wrap(rail)(input) };
}

async function accountOf(code: string) {
  return { server: fake.base, bearer: KEY, code, accountId: (await identityOf(code)).accountId, network: "testnet", accountProof: await authSecretOf(code) };
}

async function patchNameOf(code: string): Promise<string> {
  const crypt = await loadCrypto();
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const name = crypt.recovery_patch_name(derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]));
  derived.fill(0);
  return name;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

test("with the copy on, the list rides in the file's quilt and the server is told which quilt", async () => {
  await withAccount(fake, "ride-on", async (code) => {
    await serveThreeFiles(fake, code);
    fake.copyOn = true;
    fake.recordedSeq = 3;
    const spy = quiltProtocol();
    const { rail, given } = railThat();
    const { ride, planned, paid } = await rideThrough(rail, { account: await accountOf(code), protocol: spy.protocol }, await inputOf(code));

    const blobs = spy.encoded.at(-1);
    assert.ok(blobs !== undefined, "nothing was laid out as a quilt");
    assert.equal(planned, given[0]?.length, "the quilt priced is not the quilt handed to the rail");
    const listName = await patchNameOf(code);
    const list = blobs.find((b) => b.identifier === listName);
    const file = blobs.find((b) => b.contents === STREAM);
    assert.ok(list !== undefined, "no patch under the name the NMTS key derives (NCF-3 §2.5)");
    assert.ok(file !== undefined);
    assert.notEqual(given[0], STREAM, "the rail was handed the bare file, not the quilt");

    // ⛔ THE PART NAMES ITS PATCH, AND ITS OWN LENGTH — not the quilt's.
    assert.equal(paid.sealedLen, STREAM.length);
    assert.equal(paid.blobId, blobIdOf(given[0] ?? new Uint8Array()));
    const quilts = pathToFileURL(join(import.meta.dirname, "..", "node_modules", "@mysten", "walrus", "dist", "utils", "quilts.mjs")).href;
    const sdk: unknown = await import(quilts);
    const encodeId = field(sdk, "encodeQuiltPatchId");
    assert.ok(typeof encodeId === "function");
    const placed = encodeQuilt({ blobs: [...blobs], numShards: 1000 }).index.patches.find((p) => p.identifier === file.identifier);
    assert.ok(placed !== undefined);
    assert.equal(
      paid.patchId,
      String(encodeId({ quiltId: paid.blobId, patchId: { version: 1, startIndex: placed.startIndex, endIndex: placed.endIndex } })),
      "the patch id is not the one an aggregator reads",
    );

    // ⛔ WHAT RODE OPENS, AND NAMES THE FILE IN ITS OWN QUILT.
    const opened = await openRecoveryList(code, toBase64Url(list.contents));
    assert.equal(field(opened, "seq"), 4, "the list did not beat the server's number");
    const items = field(opened, "items");
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 4, "three stored files and the one riding");
    const riding: unknown = items.at(-1);
    assert.deepEqual(field(riding, "quilt"), { identifier: file.identifier });
    assert.equal(field(riding, "name"), "riding.pdf");
    assert.equal(field(riding, "path"), "/photos");
    assert.deepEqual(field(riding, "parts"), [{ part_index: 0, plaintext_len: 3900, network: "walrus" }], "an own-quilt item is one part with no blob id");

    assert.equal(await ride.record(), 4);
    assert.deepEqual(fake.recorded.at(-1), { kind: "walrus", seq: 4, blob_id: paid.blobId });
  });
});

test("⛔ an account's first upload rides too: with no file list yet, the list is that one file", async () => {
  await withAccount(fake, "ride-first", async (code) => {
    await fake.serve(code, null);
    fake.copyOn = true;
    const spy = quiltProtocol();
    const problems: string[] = [];
    const { rail } = railThat();
    const input = await inputOf(code);
    const { paid } = await rideThrough(rail, { account: await accountOf(code), protocol: spy.protocol, onProblem: (m) => problems.push(m) }, { ...input, entry: { ...input.entry, parentId: null } });
    assert.deepEqual(problems, []);
    assert.ok(paid.patchId !== undefined, "the first upload went up without the list");
    const listName = await patchNameOf(code);
    const list = spy.encoded.at(-1)?.find((b) => b.identifier === listName);
    assert.ok(list !== undefined);
    const items = field(await openRecoveryList(code, toBase64Url(list.contents)), "items");
    assert.ok(Array.isArray(items));
    assert.deepEqual(items.map((i: unknown) => field(i, "name")), ["riding.pdf"]);
  });
});

test("with the copy off, the file goes up on its own and nothing is recorded", async () => {
  await withAccount(fake, "ride-off", async (code) => {
    await serveThreeFiles(fake, code);
    const spy = quiltProtocol();
    const { rail, given } = railThat();
    const { ride, planned, paid } = await rideThrough(rail, { account: await accountOf(code), protocol: spy.protocol }, await inputOf(code));
    assert.equal(planned, null);
    assert.equal(given[0], STREAM);
    assert.equal(paid.patchId, undefined);
    assert.equal(spy.encoded.length, 0);
    assert.equal(await ride.record(), null);
    assert.equal(fake.recorded.length, 0);
  });
});

test("⛔ a list that cannot be built never fails the upload — it is said, and the file goes up alone", async () => {
  await withAccount(fake, "ride-broken", async (code) => {
    await serveThreeFiles(fake, code);
    fake.copyOn = true;
    // A stored file the sealed file list does not describe: the list refuses to be written.
    fake.source = [...fake.source, { id: "zz", size: 1, created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z", parts: [] }];
    const problems: string[] = [];
    const { rail, given } = railThat();
    const { planned, paid } = await rideThrough(rail, { account: await accountOf(code), protocol: quiltProtocol().protocol, onProblem: (m) => problems.push(m) }, await inputOf(code));
    assert.equal(planned, null, "a list that cannot be built was priced as riding");
    assert.equal(given[0], STREAM, "a broken list stopped or changed the upload");
    assert.equal(paid.patchId, undefined);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /was left out of this upload/);
  });
});

test("a resumed upload reports the same patch without laying the quilt out again", async () => {
  await withAccount(fake, "ride-resume", async (code) => {
    await serveThreeFiles(fake, code);
    fake.copyOn = true;
    const input = await inputOf(code);
    const first = railThat();
    const spy = quiltProtocol();
    const { paid } = await rideThrough(first.rail, { account: await accountOf(code), protocol: spy.protocol }, input);
    const laidOut = spy.encoded.length;
    const quilt = first.given[0] ?? new Uint8Array();
    // What the wallet rail writes before it signs: the bytes it was handed, and their length.
    const record: Reservation = {
      attempt: 0, runId: input.runId, paidFrom: "wallet", blobId: paid.blobId, nonceB64: "bm9uY2U", rootHashB64: "cm9vdA",
      relayUrl: input.relayUrl, epochs: 2, sealedLen: quilt.length, plaintextLen: 3900, partPlaintextLen: 3900,
      partIndex: 0, partTotal: 1, dekWrapped: input.entry.dekWrapped, contentHashCt: input.entry.contentHashCt,
      name: input.entry.name, parentId: input.entry.parentId,
    };
    await writeReservation(input.key, record, quilt);
    const again = railThat();
    const { planned, paid: resumed } = await rideThrough(again.rail, { account: await accountOf(code), protocol: spy.protocol }, { ...input, sealed: quilt });
    assert.equal(spy.encoded.length, laidOut, "the resume laid the quilt out again");
    assert.equal(planned, quilt.length, "the resume did not price the quilt the first run stored");
    assert.equal(again.given[0], quilt);
    assert.equal(resumed.patchId, paid.patchId);
    assert.equal(resumed.sealedLen, STREAM.length);
  });
});
