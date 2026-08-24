// What an account code's wallet is, and what a balance is allowed to claim.
//
// ⛔ THE ENGINE IS NOT MOCKED. The point of the derivation tests is that the SAME WebAssembly the
//    browser runs produces the same address here; a fake would prove only that this file agrees
//    with itself. What IS supplied is the chain, because the questions worth asking about balances
//    are the ones a healthy chain never answers: a coin type that does not exist, a node that
//    times out, a zero nobody can vouch for.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import {
  addressFromDerived,
  addressFromSeed,
  coinAmount,
  readBalances,
  walCoinType,
  walletAddress,
  SUI_COIN_TYPE,
  type ChainReader,
} from "../src/wallet.ts";
import { generateCode } from "./helpers.ts";

/**
 * Fixed seeds and the addresses they must produce.
 *
 * ⛔ NOT THIS PACKAGE'S OWN OUTPUT. The same three pairs are what the standalone NMTS recovery
 *    tool holds ITS address computation to, and that program shares no code with this one — it
 *    builds an address from scratch in Rust, with no Sui library anywhere in it. So a change here
 *    that quietly altered what an address is has to disagree with an implementation that could not
 *    have been changed at the same time.
 *
 * ⚠ The seeds are constants and hold nothing: an all-zero seed and an all-ones seed are not keys
 *   anybody derives, and no account produces them.
 */
const SEED_VECTORS: readonly (readonly [string, string])[] = [
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0x7a1378aafadef8ce743b72e8b248295c8f61c102c94040161146ea4d51a182b6",
  ],
  [
    "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
    "0x7573c697fa68450f04fa0dee2d39dcdc8a5ccf5db547f3e47638a6f8eeeec110",
  ],
  [
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "0x20a33b9a86e89aa22b4c6f7e4c53e8a37444c92a6f18a28bdbd7a37ba85e0646",
  ],
];

function bytesOf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── the address ───────────────────────────────────────────────────────────────────────────────

test("⛔ a seed produces the address another implementation of this derivation produces", () => {
  for (const [hex, address] of SEED_VECTORS) {
    assert.equal(addressFromSeed(bytesOf(hex)), address, `seed ${hex}`);
  }
});

test("⛔ the address is the one the browser derives — same offsets, same index, same key type", async () => {
  // The browser's steps, written out with the numbers rather than with this package's own table,
  // so that moving the wallet root or reaching for another wallet has to disagree with them:
  // bytes [176,208) of the derivation are the wallet root, the built-in wallet is index 0, and the
  // seed becomes an Ed25519 keypair whose Sui address is what gets shown.
  const code = await generateCode();
  const glue = await loadCrypto();
  const derived = glue.kdf_derive(glue.account_code_parse(code));
  const root = derived.slice(176, 208);
  const seed = glue.wallet_seed_for(root, 0);
  const asTheBrowserWouldSayIt = Ed25519Keypair.fromSecretKey(seed).toSuiAddress();
  derived.fill(0);
  root.fill(0);
  seed.fill(0);

  assert.equal(await walletAddress(code), asTheBrowserWouldSayIt);
});

test("an address looks like a Sui address, and the same code always gives the same one", async () => {
  const code = await generateCode();
  const address = await walletAddress(code);
  assert.match(address, /^0x[0-9a-f]{64}$/);
  assert.equal(await walletAddress(code), address, "the derivation is not deterministic");
});

test("two account codes do not share a wallet", async () => {
  const [a, b] = [await walletAddress(await generateCode()), await walletAddress(await generateCode())];
  assert.notEqual(a, b);
});

test("a malformed code is refused, and the refusal never repeats it back", async () => {
  const bogus = "SECRETLOOKINGGARBAGE9999";
  const failure = await walletAddress(bogus).then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  assert.ok(!String(failure).includes(bogus), "the refusal carried the input");
});

test("⛔ the wallet root and the seed are wiped before the address is handed back", async () => {
  const glue = await loadCrypto();
  const derived = glue.kdf_derive(glue.account_code_parse(await generateCode()));
  // The REAL engine function, wrapped rather than replaced: what is watched is which buffers it
  // was handed and handed back, which is the only way this wiping can be checked from outside.
  const seen: { root: Uint8Array | null; seed: Uint8Array | null } = { root: null, seed: null };
  const address = addressFromDerived(
    {
      wallet_seed_for(root: Uint8Array, index: number): Uint8Array {
        seen.root = root;
        const seed = glue.wallet_seed_for(root, index);
        seen.seed = seed;
        return seed;
      },
    },
    derived,
  );

  assert.match(address, /^0x[0-9a-f]{64}$/);
  const { root, seed } = seen;
  assert.ok(root !== null && seed !== null, "the engine was never asked for a wallet seed");
  assert.ok(root.every((b) => b === 0), "the wallet root was left in memory");
  assert.ok(seed.every((b) => b === 0), "the wallet seed was left in memory");
  // ⛔ AND THE CALLER'S BUFFER IS LEFT ALONE. It holds every key in the account and it is the
  //    caller's to wipe; a helper that cleared it would break the caller that still needs it.
  assert.ok(derived.some((b) => b !== 0), "it wiped a buffer that was not its own");
  derived.fill(0);
});

// ── which coin ────────────────────────────────────────────────────────────────────────────────

test("each network has its own WAL coin type, and they are not the same one", () => {
  const mainnet = walCoinType("mainnet");
  const testnet = walCoinType("testnet");
  for (const type of [mainnet, testnet]) assert.match(type, /^0x[0-9a-f]{64}::wal::WAL$/);
  assert.notEqual(mainnet, testnet, "one network's coin type would report the other's as empty");
});

// ── what a balance may claim ──────────────────────────────────────────────────────────────────

/** A chain that answers from a table, and knows exactly the coin types it was told about. */
function answering(
  totals: Readonly<Record<string, bigint>>,
  knows: readonly string[] = Object.keys(totals),
): ChainReader {
  return {
    async totalOf(coinType: string): Promise<bigint> {
      const total = totals[coinType];
      if (total === undefined) throw new Error(`nothing to answer about ${coinType}`);
      return total;
    },
    async knowsCoinType(coinType: string): Promise<boolean> {
      return knows.includes(coinType);
    },
  };
}

const WAL = walCoinType("mainnet");

test("both balances come back as the numbers the chain gave", async () => {
  const balances = await readBalances(
    answering({ [SUI_COIN_TYPE]: 1_500_000_000n, [WAL]: 42n }),
    WAL,
  );
  assert.deepEqual(balances.sui, { read: true, baseUnits: 1_500_000_000n });
  assert.deepEqual(balances.wal, { read: true, baseUnits: 42n });
});

test("⛔ one coin failing does not silence the other", async () => {
  const reader: ChainReader = {
    async totalOf(coinType: string): Promise<bigint> {
      if (coinType === SUI_COIN_TYPE) throw new Error("the node timed out");
      return 7n;
    },
    async knowsCoinType(): Promise<boolean> {
      return true;
    },
  };
  const balances = await readBalances(reader, WAL);
  assert.equal(balances.sui.read, false);
  assert.ok(!balances.sui.read && balances.sui.why.includes("timed out"));
  assert.deepEqual(balances.wal, { read: true, baseUnits: 7n });
});

test("⛔ a zero for a coin type this chain has never heard of is NOT reported as a zero", async () => {
  // Measured behaviour, and the reason this check exists: asking a Sui node for a coin type that
  // does not exist answers a balance of 0, exactly like an empty wallet does.
  const balances = await readBalances(answering({ [SUI_COIN_TYPE]: 0n, [WAL]: 0n }, [SUI_COIN_TYPE]), WAL);
  assert.equal(balances.wal.read, false, "an unknown coin type was reported as an empty wallet");
  assert.ok(!balances.wal.read && balances.wal.why.includes("WAL coin type"));
  // The chain's own coin gets no such check and does not need one: a zero there is a zero.
  assert.deepEqual(balances.sui, { read: true, baseUnits: 0n });
});

test("a zero the chain vouches for is a zero", async () => {
  const balances = await readBalances(answering({ [SUI_COIN_TYPE]: 0n, [WAL]: 0n }), WAL);
  assert.deepEqual(balances.wal, { read: true, baseUnits: 0n });
});

test("⛔ a zero whose check could not be made is not a confirmed zero either", async () => {
  const reader: ChainReader = {
    async totalOf(): Promise<bigint> {
      return 0n;
    },
    async knowsCoinType(): Promise<boolean> {
      throw new Error("the node refused the question");
    },
  };
  const balances = await readBalances(reader, WAL);
  assert.equal(balances.wal.read, false);
  assert.ok(!balances.wal.read && balances.wal.why.includes("refused the question"));
});

test("a balance that is not zero is its own proof, and costs no second question", async () => {
  let asked = 0;
  const reader: ChainReader = {
    async totalOf(): Promise<bigint> {
      return 1n;
    },
    async knowsCoinType(): Promise<boolean> {
      asked += 1;
      return true;
    },
  };
  const balances = await readBalances(reader, WAL);
  assert.deepEqual(balances.wal, { read: true, baseUnits: 1n });
  assert.equal(asked, 0, "it asked a question it already had the answer to");
});

// ── the number a person reads ─────────────────────────────────────────────────────────────────

test("⛔ an amount is exact — dust never reads as zero and big totals keep every digit", () => {
  assert.equal(coinAmount(0n), "0");
  assert.equal(coinAmount(1n), "0.000000001");
  assert.equal(coinAmount(1_000_000_000n), "1");
  assert.equal(coinAmount(1_500_000_000n), "1.5");
  // Past what a JavaScript number holds without losing digits — 12,345,678,901.23456789 coins.
  assert.equal(coinAmount(12_345_678_901_234_567_890n), "12345678901.23456789");
});
