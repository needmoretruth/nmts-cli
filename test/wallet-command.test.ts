// `nmts wallet` from the outside: what it prints, what it never prints, and what it exits.
//
// ⛔ THE CHAIN IS SUPPLIED, NOT REACHED FOR. A test that read a live chain could not run offline,
//    would answer differently every day, and — the part that matters here — could never be asked
//    for the answers this command exists to handle: a node that refuses, and a zero nobody can
//    vouch for. Every one of those is a branch that decides what a person is told about money.
//
// ⛔ AND THE ACCOUNT CODE IS REAL. It is generated for the run and belongs to nobody, but every
//    key below is derived from it by the same engine the product uses, so the test that nothing
//    secret is printed can compare against the ACTUAL key rather than against a placeholder.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { wallet } from "../src/commands/wallet.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import type { Network } from "../src/network.ts";
import { SUI_COIN_TYPE, walCoinType, walletAddress, type ChainReader } from "../src/wallet.ts";
import { generateCode, grantConsents } from "./helpers.ts";

/** Lines, in the order they were said. */
function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/**
 * An account code on a machine of its own, for the length of one test.
 *
 * The `plain-env` agreement is written in because reading a code out of the environment asks for
 * it once per machine; the agreement itself is tested where it belongs, beside the ladder.
 */
async function withAccount(name: string, body: (code: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

/** What the command asked the chain. */
interface Asked {
  opened: { network: Network; address: string }[];
  totals: string[];
  known: string[];
}

/** A chain that answers from a table and remembers every question it was asked. */
function chain(
  totals: Readonly<Record<string, bigint>>,
  options: { knows?: readonly string[]; refuse?: readonly string[] } = {},
): { asked: Asked; open: (network: Network, address: string) => ChainReader } {
  const asked: Asked = { opened: [], totals: [], known: [] };
  const knows = options.knows ?? Object.keys(totals);
  return {
    asked,
    open(network: Network, address: string): ChainReader {
      asked.opened.push({ network, address });
      return {
        async totalOf(coinType: string): Promise<bigint> {
          asked.totals.push(coinType);
          if (options.refuse?.includes(coinType)) throw new Error("the node did not answer");
          const total = totals[coinType];
          if (total === undefined) throw new Error(`nothing to answer about ${coinType}`);
          return total;
        },
        async knowsCoinType(coinType: string): Promise<boolean> {
          asked.known.push(coinType);
          return knows.includes(coinType);
        },
      };
    },
  };
}

/** A chain that must not be opened. Opening it is the failure, so it says so where nothing hides it. */
function noChain(): (network: Network, address: string) => ChainReader {
  return () => {
    throw new Error("the chain was opened for a command that is supposed to answer offline");
  };
}

const FULL = { [SUI_COIN_TYPE]: 1_500_000_000n, [walCoinType("mainnet")]: 42n };

// ── the address, offline ──────────────────────────────────────────────────────────────────────

test("⛔ `wallet address` answers from the account code alone and opens no chain", async () => {
  await withAccount("wallet-address", async (code) => {
    const out = collect();
    assert.equal(await wallet("address", { write: out.write, openChain: noChain() }), 0);
    assert.equal(out.lines[0], `Address  ${await walletAddress(code)}`);
    assert.ok(
      out.lines.some((line) => line.includes("Nothing was asked of the NMTS server")),
      "it did not say that it answered offline",
    );
  });
});

test("`wallet address --json` is the address and nothing else", async () => {
  await withAccount("wallet-address-json", async (code) => {
    const out = collect();
    assert.equal(await wallet("address", { json: true, write: out.write, openChain: noChain() }), 0);
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.deepEqual(parsed, { address: await walletAddress(code) });
  });
});

// ── the balances ──────────────────────────────────────────────────────────────────────────────

test("it prints the address, the network and both balances", async () => {
  await withAccount("wallet-balances", async (code) => {
    const out = collect();
    const fake = chain(FULL);
    const exit = await wallet(undefined, {
      network: "mainnet",
      write: out.write,
      openChain: fake.open,
    });
    assert.equal(exit, 0);
    assert.deepEqual(fake.asked.opened, [{ network: "mainnet", address: await walletAddress(code) }]);
    assert.equal(out.lines[0], `Address  ${await walletAddress(code)}`);
    assert.equal(out.lines[1], `Network  mainnet`);
    assert.equal(out.lines[2], `SUI      1.5`);
    assert.equal(out.lines[3], `WAL      0.000000042`);
  });
});

test("⛔ which network the run is on decides which coin it asks about", async () => {
  // A tool that asked one network's WAL coin type on the other would report every wallet on that
  // network as holding no WAL — as a fact, not as a failure.
  //
  // ⛔ WHAT IS COMPARED IS THE TWO ANSWERS, NOT EITHER ONE AGAINST THE TABLE THEY CAME FROM.
  //    Asserting "it asked for `walCoinType(network)`" reads well and proves nothing: the
  //    expectation is built by the same function the command called, so a table that answered the
  //    same string for every network would move both halves together and stay green. Measured —
  //    that version of this test did not go red when the lookup was broken on purpose.
  const asked: Record<string, string> = {};
  for (const network of ["mainnet", "testnet"] as const) {
    await withAccount(`wallet-coin-${network}`, async () => {
      const fake = chain({ [SUI_COIN_TYPE]: 0n, [walCoinType(network)]: 5n });
      assert.equal(
        await wallet(undefined, { network, write: collect().write, openChain: fake.open }),
        0,
      );
      const wal = fake.asked.totals.filter((type) => type !== SUI_COIN_TYPE);
      const one = wal[0];
      assert.ok(one !== undefined && wal.length === 1, `it asked about ${wal.join(", ")}`);
      asked[network] = one;
    });
  }
  assert.match(String(asked["mainnet"]), /::wal::WAL$/);
  assert.notEqual(
    asked["mainnet"],
    asked["testnet"],
    "both networks were asked about the same coin, so one of them was asked the wrong question",
  );
});

test("--json carries the exact total as a string and the same value as a person reads it", async () => {
  await withAccount("wallet-json", async (code) => {
    const out = collect();
    const fake = chain(FULL);
    assert.equal(
      await wallet(undefined, { network: "mainnet", json: true, write: out.write, openChain: fake.open }),
      0,
    );
    assert.deepEqual(JSON.parse(out.lines.join("")), {
      address: await walletAddress(code),
      network: "mainnet",
      sui: { coinType: SUI_COIN_TYPE, read: true, baseUnits: "1500000000", amount: "1.5" },
      wal: {
        coinType: walCoinType("mainnet"),
        read: true,
        baseUnits: "42",
        amount: "0.000000042",
      },
    });
  });
});

// ── a number nobody has ───────────────────────────────────────────────────────────────────────

test("⛔ a balance that could not be read is said so, is not a zero, and exits non-zero", async () => {
  await withAccount("wallet-unread", async () => {
    const out = collect();
    const fake = chain(FULL, { refuse: [walCoinType("mainnet")] });
    const exit = await wallet(undefined, { network: "mainnet", write: out.write, openChain: fake.open });
    assert.equal(exit, 1, "a missing balance exited as if everything had been read");
    const wal = out.lines.find((line) => line.startsWith("WAL"));
    assert.ok(wal !== undefined && wal.includes("could not be read"), `WAL line said: ${String(wal)}`);
    assert.ok(wal !== undefined && !/\b0\b/.test(wal), `a number nobody has was printed: ${String(wal)}`);
    assert.ok(out.lines.some((line) => line.includes("never as zero")), "it did not explain the gap");
  });
});

test("⛔ the same, machine-readable: read is false and there is no number to mistake", async () => {
  await withAccount("wallet-unread-json", async () => {
    const out = collect();
    const fake = chain(FULL, { refuse: [SUI_COIN_TYPE] });
    assert.equal(
      await wallet(undefined, { network: "mainnet", json: true, write: out.write, openChain: fake.open }),
      1,
    );
    const parsed: unknown = JSON.parse(out.lines.join(""));
    const sui: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "sui") : null;
    assert.deepEqual(sui, {
      coinType: SUI_COIN_TYPE,
      read: false,
      error: "the node did not answer",
    });
  });
});

test("⛔ a zero for a coin type the chain does not know reaches the person as a gap, not as empty", async () => {
  await withAccount("wallet-unknown-coin", async () => {
    const out = collect();
    // The measured hazard: a Sui node answers a balance of 0 for a coin type that does not exist,
    // which is the same answer an empty wallet gives.
    const fake = chain({ [SUI_COIN_TYPE]: 0n, [walCoinType("mainnet")]: 0n }, { knows: [SUI_COIN_TYPE] });
    assert.equal(
      await wallet(undefined, { network: "mainnet", write: out.write, openChain: fake.open }),
      1,
    );
    const wal = out.lines.find((line) => line.startsWith("WAL"));
    assert.ok(wal !== undefined && wal.includes("could not be read"), `WAL line said: ${String(wal)}`);
    assert.equal(out.lines[2], `SUI      0`, "a zero the chain vouches for should still print as 0");
  });
});

// ── what never comes out ──────────────────────────────────────────────────────────────────────

test("⛔ nothing this command prints carries the account code or the wallet's private key", async () => {
  await withAccount("wallet-secrets", async (code) => {
    const glue = await loadCrypto();
    const derived = glue.kdf_derive(glue.account_code_parse(code));
    const root = derived.slice(176, 208);
    const seed = glue.wallet_seed_for(root, 0);
    // Every shape the key could take on the way out: the raw bytes as text, and the form a wallet
    // app imports. The last one is a real private key for this throwaway account — it exists here
    // only to be searched for.
    const secrets = [
      code,
      Buffer.from(seed).toString("hex"),
      Buffer.from(seed).toString("base64"),
      Buffer.from(seed).toString("base64url"),
      Ed25519Keypair.fromSecretKey(seed).getSecretKey(),
    ];
    derived.fill(0);
    root.fill(0);
    seed.fill(0);

    const out = collect();
    const fake = chain(FULL);
    for (const options of [{}, { json: true }] as const) {
      await wallet(undefined, { network: "mainnet", write: out.write, openChain: fake.open, ...options });
      await wallet("address", { write: out.write, openChain: noChain(), ...options });
    }
    const printed = out.lines.join("\n");
    assert.ok(printed.length > 0, "nothing was printed, so this test proved nothing");
    for (const secret of secrets) {
      assert.ok(!printed.includes(secret), "something secret reached the output");
    }
  });
});

// ── the command line ──────────────────────────────────────────────────────────────────────────

test("a word this command does not know stops, says what it does know, and asks no chain", async () => {
  await withAccount("wallet-unknown-word", async () => {
    const failure = await wallet("balnce", { openChain: noChain(), write: collect().write }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
    assert.equal(failure.exitCode, 2);
    assert.ok(String(failure.nextStep).includes("wallet address"), "it did not say what it does know");
  });
});

test("`wallet balance` is the same run as `wallet` with no word after it", async () => {
  await withAccount("wallet-balance-word", async () => {
    const spelled = collect();
    const bare = collect();
    const one = chain(FULL);
    const two = chain(FULL);
    assert.equal(
      await wallet("balance", { network: "mainnet", write: spelled.write, openChain: one.open }),
      0,
    );
    assert.equal(await wallet(undefined, { network: "mainnet", write: bare.write, openChain: two.open }), 0);
    assert.deepEqual(spelled.lines, bare.lines);
  });
});
