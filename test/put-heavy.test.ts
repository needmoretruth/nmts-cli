// `--tier standard|heavy` and the Heavy branch of an upload: which words are accepted, which options
// are refused on which payer, and which road each payer takes — credits and the wallet through one
// order, the key's own EVM wallet through the Synapse SDK. No network: the order routes, the storage
// companies and the Synapse SDK are fakes; the sealing is the real engine.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { adviseFor } from "../src/api-advice.ts";
import { parseArgs } from "../src/args.ts";
import { loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import type { commitHeavyItem } from "../src/heavy-api.ts";
import { expiryFrom, heavySelfPut, selfPayChain, type SelfPaySynapse } from "../src/heavy-self-pay.ts";
import { heavyCredits, heavyOrderPut, planHeavyFile, type HeavyFile } from "../src/heavy-upload.ts";
import { heavyWalletPut } from "../src/heavy-wallet-pay.ts";
import { heavyPayerOf, refuseHeavyClashes } from "../src/commands/heavy-run.ts";
import { tierOf } from "../src/commands/put-payer.ts";
import { actOf } from "../src/risk.ts";
import { generateCode } from "./helpers.ts";
import type { HeavyCreateOrderRequest, HeavyOrderApi } from "../src/shared/lib/api/types-heavy.ts";

const PIECE = "bafkzcibcaapc5vqvdtwpobrgygptm2qoktlo7ms6vmt3pjxfbrryptvhvvqwlly";
const COPIES = [
  { provider_id: "4", data_set_id: "1", piece_id: "7", retrieval_url: `https://a.example/piece/${PIECE}` },
  { provider_id: "9", data_set_id: "2", piece_id: "8", retrieval_url: `https://b.example/piece/${PIECE}` },
];

function refusal(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (e: unknown) => e instanceof NmtsError && e.exitCode === 2 && pattern.test(e.message));
}

test("the tier word: standard by default, heavy in any case, anything else refused naming both", () => {
  assert.equal(tierOf({}), "standard");
  assert.equal(tierOf({ tier: " HEAVY " }), "heavy");
  refusal(() => tierOf({ tier: "fast" }), /"standard" or "heavy"/);
  refusal(() => tierOf({ pay: "evm" }), /heavy/);
  refusal(() => tierOf({ copies: "3" }), /--copies/);
  const args = parseArgs(["put", "a.txt", "--tier", "heavy", "--pay", "evm", "--copies", "3", "--providers", "4,9", "--evm-wallet", "1"]);
  assert.deepEqual([args.tier, args.pay, args.copies, args.providers, args.evmWallet], ["heavy", "evm", "3", "4,9", "1"]);
  assert.equal(actOf(args), "put.evm");
  assert.equal(actOf(parseArgs(["push", "d", "--tier", "heavy", "--pay", "wallet"])), "push.wallet");
  assert.equal(actOf(parseArgs(["heavy", "fund", "5"])), "heavy.fund");
  assert.equal(actOf(parseArgs(["heavy", "wallet"])), "heavy");
});

test("each Heavy payer refuses the options that mean nothing to it, before a file is read", () => {
  assert.equal(heavyPayerOf(undefined), "credits");
  assert.equal(heavyPayerOf("evm"), "evm");
  refusal(() => refuseHeavyClashes({ epochs: "2" }, "credits"), /--epochs/);
  refusal(() => refuseHeavyClashes({ thumbnail: true }, "credits"), /--thumbnail does not apply/);
  refusal(() => refuseHeavyClashes({ thumbnailFile: "a.jpg" }, "wallet"), /--thumbnail-file/);
  refusal(() => refuseHeavyClashes({ copies: "2" }, "wallet"), /--copies/);
  refusal(() => refuseHeavyClashes({ copies: "13" }, "evm"), /--copies/);
  refusal(() => refuseHeavyClashes({ providers: "4,x" }, "evm"), /--providers/);
  refusal(() => refuseHeavyClashes({ days: "400" }, "wallet"), /--days/);
  refusal(() => refuseHeavyClashes({ days: "30" }, "credits"), /--days/);
  refuseHeavyClashes({ copies: "12", providers: "4,9", evmWallet: "2" }, "evm");
  refuseHeavyClashes({ days: "365" }, "wallet");
  // Since 2026-09-26 mainnet has allowlisted companies, so the self-paid road runs there too.
  assert.equal(selfPayChain("mainnet"), "mainnet");
  assert.equal(selfPayChain("testnet"), "calibration");
});

function source(size: number): HeavyFile["source"] {
  return {
    size,
    async *read(offset: number, length: number) {
      yield new Uint8Array(length).fill(offset % 251);
    },
  };
}

/** An order route that stores every slot at once. */
function fakeOrders(orders: HeavyCreateOrderRequest[], paid: string[]): HeavyOrderApi {
  let slots = 0;
  return {
    async createOrder(body) {
      orders.push(body);
      slots = body.slots.length;
      const price = body.pay === "wallet" ? { price: { wal_frost: "123", treasury: `0x${"a".repeat(64)}`, pay_within_secs: 3600 } } : {};
      return { order_id: "o-1", state: "open", pay: body.pay, term_days: 28, slots: body.slots.map((s) => ({ slot: s.slot, state: "open" as const })), ...price };
    },
    async getOrder() {
      const stored = Array.from({ length: slots }, (_, slot) => ({ slot, state: "stored" as const, piece_cid: PIECE, copies: COPIES }));
      return { order_id: "o-1", state: paid.length > 0 ? ("paid" as const) : ("stored" as const), pay: "credits" as const, term_days: 28, expiry_epoch: 5_000_000, slots: stored };
    },
    async targetSlot() {
      return { provider_id: "4", service_url: "https://a.example" };
    },
    async slotUploaded() {
      return { state: "committing" as const };
    },
    async markPaid(_id, body) {
      paid.push(body.tx_digest);
      return { state: "paid" as const };
    },
  };
}

async function context(commits: Parameters<typeof commitHeavyItem>[0][]) {
  return {
    server: "https://nmts.invalid",
    bearer: "k",
    crypt: await loadCrypto(),
    dataKey: new Uint8Array(32).fill(7),
    rule: "none" as const,
    deps: { pieceCid: async () => PIECE, upload: async () => undefined, sleep: async () => undefined },
    commit: async (input: Parameters<typeof commitHeavyItem>[0]) => {
      commits.push(input);
      return `item-${commits.length}`;
    },
  };
}

test("Heavy with credits: one order paid in credits, a 10-byte file raised to a legal piece, committed on network 1", async () => {
  const orders: HeavyCreateOrderRequest[] = [];
  const commits: Parameters<typeof commitHeavyItem>[0][] = [];
  const file: HeavyFile = { source: source(10), name: "a.txt", parentId: null, destination: "" };
  const plan = planHeavyFile(10, "none");
  const outcome = await heavyOrderPut({ ...(await context(commits)), api: fakeOrders(orders, []) }, [file], { pay: "credits" });
  assert.equal(orders[0]?.pay, "credits");
  assert.deepEqual(orders[0]?.slots, [{ slot: 0, sealed_len: plan[0]?.sealedLen }]);
  assert.ok((plan[0]?.sealedLen ?? 0) >= 127);
  const part = commits[0]?.parts[0];
  assert.equal(part?.network, 1);
  assert.equal(part?.blob_id, PIECE);
  assert.equal(commits[0]?.paidBy, undefined);
  assert.equal(outcome.files[0]?.itemId, "item-1");
});

test("Heavy from the wallet: the WAL is sent once, after everything is stored, and reported", async () => {
  const orders: HeavyCreateOrderRequest[] = [];
  const paid: string[] = [];
  const sent: string[] = [];
  const commits: Parameters<typeof commitHeavyItem>[0][] = [];
  const file: HeavyFile = { source: source(5000), name: "b.bin", parentId: null, destination: "" };
  await heavyOrderPut({ ...(await context(commits)), api: fakeOrders(orders, paid) }, [file], {
    pay: "wallet",
    payer: `0x${"b".repeat(64)}`,
    termDays: 30,
    payWallet: async (price) => {
      sent.push(price.wal_frost);
      return "DIGEST";
    },
  });
  assert.equal(orders[0]?.pay, "wallet");
  assert.equal(orders[0]?.term_days, 30);
  assert.deepEqual(sent, ["123"]);
  assert.deepEqual(paid, ["DIGEST"]);
  assert.equal(commits.length, 1);
});

test("Heavy from the wallet, primary road: a short wallet stops before a byte is sealed; a covered one sends the quoted WAL once", async () => {
  const code = await generateCode();
  const purse = (wal: bigint) => ({
    readWallet: async () => ({ sui: { read: true as const, baseUnits: 10n ** 9n }, wal: { read: true as const, baseUnits: wal } }),
    estimateFee: async () => 5_000n,
  });
  const run = async (wal: bigint) => {
    const orders: HeavyCreateOrderRequest[] = [];
    const paid: string[] = [];
    const shapes: { amount: bigint; to: string }[] = [];
    const steps: string[] = [];
    const commits: Parameters<typeof commitHeavyItem>[0][] = [];
    const ctx = await context(commits);
    const api = fakeOrders(orders, paid);
    const opening = api.createOrder.bind(api);
    api.createOrder = async (body) => {
      steps.push("order");
      return opening(body);
    };
    const put = heavyWalletPut(
      { ...ctx, api },
      [{ source: source(5000), name: "w.bin", parentId: null, destination: "" }],
      {
        code,
        network: "testnet",
        wallet: 0,
        termDays: 28,
        reads: purse(wal),
        approve: (q) => void steps.push(`approve ${q.walFrost}`),
        onPaid: (spent) => void steps.push(`paid ${spent.walFrost}+${spent.suiMist}`),
        sign: async (shape) => {
          shapes.push({ amount: shape.amountBaseUnits, to: shape.destination });
          return "DIGEST";
        },
      },
    );
    return { put, orders, paid, shapes, steps, commits };
  };
  const short = await run(100n);
  await assert.rejects(short.put, (e: unknown) => e instanceof NmtsError && e.exitCode === 4);
  // Short: the quote's order and nothing after it — no approval, no run, no signature, no file.
  assert.deepEqual([short.steps, short.shapes, short.commits.length], [["order"], [], 0]);
  const covered = await run(1_000n);
  const done = await covered.put;
  // Covered: quoted, approved, the same order run, and the WAL sent last.
  assert.deepEqual(covered.steps, ["order", "approve 123", "order", "paid 123+5000"]);
  assert.deepEqual(covered.shapes, [{ amount: 123n, to: `0x${"a".repeat(64)}` }]);
  assert.deepEqual(covered.paid, ["DIGEST"]);
  assert.equal(covered.orders[0]?.idempotency_key, covered.orders[1]?.idempotency_key, "the run reopened a different order");
  assert.equal(done.quote.walFrost, 123n);
  assert.equal(covered.commits.length, 1);
});

test("Heavy from the key's own EVM wallet: no order, the copies the SDK kept, paid_by and the deposit's end", async () => {
  const commits: Parameters<typeof commitHeavyItem>[0][] = [];
  const asked: { copies: number; providerIds?: bigint[] }[] = [];
  const synapse: SelfPaySynapse = {
    async upload(_bytes, options) {
      asked.push({ copies: options.copies, ...(options.providerIds === undefined ? {} : { providerIds: options.providerIds }) });
      return { pieceCid: PIECE, copies: [{ providerId: 4n, dataSetId: 11n, pieceId: 2n, retrievalUrl: COPIES[0]?.retrieval_url ?? "" }] };
    },
    async runway() {
      return { epoch: 3_000_000n, runwayInEpochs: 86_400n };
    },
  };
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const ctx = await context(commits);
  const done = await heavySelfPut(
    { ...ctx, network: "testnet", account, copies: 3, providers: [4n, 9n], synapse },
    [{ source: source(10), name: "c.txt", parentId: null, destination: "" }],
  );
  assert.deepEqual(asked, [{ copies: 3, providerIds: [4n, 9n] }]);
  assert.equal(commits[0]?.paidBy, account.address);
  const part = commits[0]?.parts[0];
  assert.equal(part?.owner_kind, 0);
  // runway 86,400 beyond the lockup + the 30-day lockup itself
  assert.equal(part?.expiry_epoch, 3_172_800);
  assert.deepEqual(part?.copies, [{ provider_id: "4", data_set_id: "11", piece_id: "2", retrieval_url: COPIES[0]?.retrieval_url }]);
  assert.equal(done.expiryEpoch, 3_172_800);
});

test("a self-paid Heavy file's end counts the 30-day lockup after the runway", () => {
  // 28 days deposit exactly the lockup: the SDK's runway is 0 and the file still has 30 days.
  assert.equal(expiryFrom({ epoch: 6_410_285n, runwayInEpochs: 0n }), 6_410_285 + 86_400);
  // No rate at all (the SDK's largest uint256): the lockup alone.
  assert.equal(expiryFrom({ epoch: 100n, runwayInEpochs: 2n ** 256n - 1n }), 100 + 86_400);
});

test("every Heavy refusal the server answers with has a next step", () => {
  for (const code of ["heavy_unavailable", "heavy_wallet_pay_off", "heavy_price_unavailable", "unpaid_orders_cap"]) {
    assert.ok(adviseFor(code), code);
  }
  assert.match(adviseFor("heavy_price_unavailable") ?? "", /nothing was charged.*credits/);
});

test("a Heavy slot costs half its Standard credits, rounded up, and at least one", () => {
  const MIB = 1024 * 1024;
  const part = (sealedLen: number) => ({ partIndex: 0, offset: 0, length: sealedLen, sealFrom: sealedLen, sealedLen });
  assert.equal(heavyCredits([part(1)]), 1);
  assert.equal(heavyCredits([part(3 * MIB)]), 2);
  assert.equal(heavyCredits([part(10 * MIB), part(2 * MIB)]), 5 + 1);
});
