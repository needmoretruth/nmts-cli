// The price a person agrees to is the price of the bytes that are registered — with the recovery
// list riding in the quilt and without it (spec 2026-09-20 unit B, review of 11-10).
//
// ⛔ THE QUILT IS LARGER THAN THE FILE. Storage is bought for the bytes handed to the register
//    signature, so the review's WAL line, the shortfall check and what the ledger is told must all be
//    the quote for those same bytes. A quote taken on the file alone while a quilt is registered lets
//    the spend pass the amount agreed, and fails a wallet holding exactly what the review asked for.
//
// ⛔ THE ARITHMETIC IS THE FAKE CHAIN'S, NOT THE PRODUCT'S: `sealedLen × epochs` of storage plus
//    `sealedLen` of write (`fake-put-wallet.ts`), so the price of a length is known from outside.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { after, test } from "node:test";

import { encodeQuilt } from "@mysten/walrus";

import { identityOf } from "../src/account.ts";
import { toBase64Url } from "../src/bytes.ts";
import { loadCrypto } from "../src/crypto.ts";
import { fileSource } from "../src/upload-file-node.ts";
import { describeUploadReview } from "../src/upload-wallet-plan.ts";
import { coinAmount } from "../src/wallet.ts";
import { walletPut, type WalletPutOutcome, type WalletPutReview } from "../src/upload-wallet-put.ts";
import type { BlobProtocol } from "../src/upload-wire.ts";
import type { Spend } from "../src/wallet-grant.ts";
import { KEY } from "./fake-drive.ts";
import { FILE, fakeReads, recordingSigners, refuseToSign } from "./fake-put-wallet.ts";
import { startFakeRecovery, withAccount } from "./fake-recovery.ts";
import { serveThreeFiles } from "./recovery-bytes-fixture.ts";
import { apiThat, protocolThat } from "./upload-fixture.ts";

const fake = await startFakeRecovery();
after(() => fake.close());

const EPOCHS = 2;
const blobIdOf = (bytes: Uint8Array): string => toBase64Url(createHash("sha256").update(bytes).digest());
const priceOf = (sealedLen: number): bigint => BigInt(sealedLen) * BigInt(EPOCHS) + BigInt(sealedLen);

/** The storage network's protocol with the Walrus SDK's own quilt layout, offline. */
function quiltProtocol(): BlobProtocol & { relayUrl: string } {
  return {
    ...protocolThat({
      // A blob id as the network spells one, since a patch id is built from it.
      async computeMetadata({ bytes, nonce }) {
        const fill = (n: number): Uint8Array => new Uint8Array(32).fill(n);
        return { blobId: blobIdOf(bytes), rootHash: fill(1), nonce: nonce ?? fill(2), blobDigest: fill(3) };
      },
      async uploadToRelay({ blobId, bytes }) {
        if (blobIdOf(bytes) !== blobId) throw new Error("relay refuses: these bytes are another blob");
        return { signers: [0, 1], serialized_message_b64: "bQ", signature_b64: "cw" };
      },
      async encodeQuilt(blobs) {
        const { quilt, index } = encodeQuilt({ blobs: [...blobs], numShards: 1000 });
        return { quilt, patches: index.patches.map((p) => ({ identifier: p.identifier, startIndex: p.startIndex, endIndex: p.endIndex })) };
      },
    }),
    relayUrl: "https://relay.example",
  };
}

interface Run {
  review: WalletPutReview | null;
  spent: Spend[];
  registered: number[];
  outcome: WalletPutOutcome | null;
  problems: string[];
}

async function putOnce(code: string, sign: ReturnType<typeof recordingSigners> | ReturnType<typeof refuseToSign>): Promise<Run> {
  const run: Run = { review: null, spent: [], registered: [], outcome: null, problems: [] };
  const recording = "registered" in sign ? sign : null;
  try {
    run.outcome = await walletPut(
      {
        code,
        apiKey: KEY,
        server: fake.base,
        network: "testnet",
        accountId: (await identityOf(code)).accountId,
        crypt: await loadCrypto(),
        partSize: 64 * 2 ** 20,
        rule: "padme",
        wallet: 0,
      },
      { source: fileSource(FILE, statSync(FILE).size), name: "notes.txt", parentId: "f1", destination: "/photos" },
      {
        epochs: EPOCHS,
        readChain: () => fakeReads(),
        sign,
        protocol: () => quiltProtocol(),
        api: apiThat().api,
        onReview: (review) => (run.review = review),
        onSpend: (spend) => run.spent.push(spend),
        onRecoveryProblem: (message) => run.problems.push(message),
      },
    );
  } finally {
    run.registered = recording === null ? [] : recording.registered.map((a) => a.part.sealedLen);
  }
  return run;
}

/** What every run must hold: one length quoted, registered and told to the ledger. */
function agreesWithRegister(run: Run): void {
  assert.ok(run.review !== null, "no review was given");
  const [registered] = run.registered;
  assert.ok(registered !== undefined, "nothing was registered");
  assert.equal(run.review.sealedBytes, registered, "the review names other bytes than the ones registered");
  assert.equal(run.review.budget.walNeededFrost, priceOf(registered), "the WAL agreed is not the price of the bytes registered");
  assert.deepEqual(run.spent.map((s) => s.walFrost), [run.review.budget.walNeededFrost], "the ledger was told another amount than the one agreed");
}

test("⛔ with the list riding, the quilt is what is quoted, agreed, registered and spent", async () => {
  await withAccount(fake, "price-ride", async (code) => {
    await serveThreeFiles(fake, code);
    fake.copyOn = true;
    const run = await putOnce(code, recordingSigners());
    assert.deepEqual(run.problems, []);
    assert.ok(run.outcome?.kind === "uploaded" && run.outcome.recoveryList !== null, "the list did not ride");
    agreesWithRegister(run);

    // ⛔ AND THE PERSON READS THAT PRICE, with the reason it is more than the file.
    const review = run.review;
    assert.ok(review !== null);
    const said: string[] = [];
    describeUploadReview(
      (line) => said.push(line),
      { ...review, walNeeded: review.budget.walNeededFrost, networkCopy: true },
      review.budget,
    );
    assert.match(said[0] ?? "", new RegExp(`→  ${coinAmount(priceOf(run.registered[0] ?? 0)).replace(".", "\\.")} WAL from the wallet`));
    assert.ok(said.includes("  The newest recovery list goes up with this file, and the WAL above includes it."));
  });
});

test("without the list, the file alone is quoted, agreed, registered and spent", async () => {
  await withAccount(fake, "price-alone", async (code) => {
    await serveThreeFiles(fake, code);
    const run = await putOnce(code, recordingSigners());
    assert.ok(run.outcome?.kind === "uploaded" && run.outcome.recoveryList === null);
    agreesWithRegister(run);
  });
});

test("⛔ a resumed ride quotes the quilt the first run stored, not the file", async () => {
  await withAccount(fake, "price-resume-ride", async (code) => {
    await serveThreeFiles(fake, code);
    fake.copyOn = true;
    await assert.rejects(putOnce(code, refuseToSign("the first run stops at its signature")));
    const run = await putOnce(code, recordingSigners());
    assert.ok(run.outcome?.kind === "uploaded" && run.outcome.recoveryList !== null, "the resume dropped the list");
    agreesWithRegister(run);
  });
});

test("a resume after the list did not ride quotes the file, even with the copy switched on since", async () => {
  await withAccount(fake, "price-resume-alone", async (code) => {
    await serveThreeFiles(fake, code);
    await assert.rejects(putOnce(code, refuseToSign("the first run stops at its signature")));
    fake.copyOn = true;
    const run = await putOnce(code, recordingSigners());
    assert.ok(run.outcome?.kind === "uploaded" && run.outcome.recoveryList === null, "a resume laid out a new quilt");
    agreesWithRegister(run);
  });
});
