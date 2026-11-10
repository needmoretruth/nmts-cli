// The price of an upload with no account: the parts `put` would make, what each costs, and the
// fee estimate with where it came from. The chain is a table here; on testnet the same numbers were
// held against `put({ dryRun })` for 1 MiB and 100 MiB (plan 2026-11-10 §1.1, gap C).

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { gasEstimate, MEASURED_GAS, quoteUpload, type UploadQuoteReads } from "../src/upload-quote.ts";

const MIB = 1024 * 1024;

/** Testnet's prices of 2026-11-10: per MiB of sealed size, 3735 FROST an epoch to store, 7469 to write. */
function table(over: { price?: bigint | null; window?: null } = {}): UploadQuoteReads & { asked: number[][] } {
  const asked: number[][] = [];
  return {
    asked,
    async readWindow() {
      return over.window === null ? null : { clock: { current: 577, durationMs: 86_400_000, startedMs: 0 }, maxAhead: 53 };
    },
    async quoteParts(sealedLens, epochs) {
      asked.push([...sealedLens]);
      return sealedLens.map((sealedLen) => {
        const units = BigInt(Math.ceil(sealedLen / MIB));
        return { sealedLen, storageFrost: units * 3735n * BigInt(epochs), writeFrost: units * 7469n, tipMist: 105n };
      });
    },
    async referenceGasPrice() {
      return over.price === undefined ? 1000n : over.price;
    },
    async encodedLength(len) {
      return 70_038_000 + Math.ceil(len / MIB) * 2_000_000;
    },
  };
}

test("1 MiB: one part sealed to 2 MiB, its WAL, the tip, the fee estimate and the credits", async () => {
  const quote = await quoteUpload("testnet", { bytes: MIB }, { reads: table(), relay: "relay.test" });
  assert.equal(quote.parts.length, 1);
  assert.equal(quote.sealedBytes, 2 * MIB);
  assert.equal(quote.epochs, 2, "the default term is not put's");
  assert.equal(quote.endEpoch, 579);
  assert.equal(quote.walFrost, String(2n * 3735n * 2n + 2n * 7469n));
  assert.equal(quote.tipMist, "105");
  assert.equal(quote.credits, 2);
  assert.equal(quote.encodedBytes, quote.parts[0]?.encodedBytes);
  // The gas the two recorded testnet transactions used, net of rebates: 3,975,277 + 1,030,598 MIST.
  assert.equal(quote.gasEstimateMist, "5005875");
  assert.match(quote.gasSource, /measured on testnet .*8XLr5kR7/);
  assert.equal(quote.relay, "relay.test");
});

test("100 MiB is two parts, like put; the credits count both", async () => {
  const reads = table();
  const quote = await quoteUpload("testnet", { bytes: 100 * MIB }, { reads });
  assert.equal(quote.parts.length, 2);
  assert.equal(reads.asked[0]?.length, 2);
  assert.equal(quote.credits, 102);
  assert.equal(quote.gasEstimateMist, String(2n * 5_005_875n));
  assert.equal(quote.encodedBytes, (quote.parts[0]?.encodedBytes ?? 0) + (quote.parts[1]?.encodedBytes ?? 0));
});

test("another term has no credit price, and a term the network does not sell is refused, not clamped", async () => {
  const five = await quoteUpload("testnet", { bytes: MIB, epochs: 5 }, { reads: table() });
  assert.equal(five.credits, null);
  assert.equal(five.endEpoch, 582);
  await assert.rejects(quoteUpload("testnet", { bytes: MIB, epochs: 54 }, { reads: table() }), NmtsError);
});

test("the fee estimate follows the reference gas price, and an unread price is refused rather than guessed", async () => {
  const double = await quoteUpload("testnet", { bytes: MIB }, { reads: table({ price: 2000n }) });
  const units = MEASURED_GAS.register.computationUnits + MEASURED_GAS.certify.computationUnits;
  assert.equal(BigInt(double.gasEstimateMist) - 5_005_875n, units * 1000n);
  assert.equal(gasEstimate(3, 1000n), 3n * 5_005_875n);
  await assert.rejects(quoteUpload("testnet", { bytes: MIB }, { reads: table({ price: null }) }), /reference gas price/);
  await assert.rejects(quoteUpload("testnet", { bytes: MIB }, { reads: table({ window: null }) }), /could not be read/);
});

test("a size that is not a whole number of bytes is refused before the chain is read", async () => {
  const reads = table();
  for (const bytes of [-1, 1.5, Number.NaN]) {
    await assert.rejects(quoteUpload("testnet", { bytes }, { reads }), NmtsError);
  }
  assert.deepEqual(reads.asked, []);
});
