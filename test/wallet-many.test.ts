// `nmts wallet list` and `nmts wallet use` — one NMTS key, many wallets, and which of them pays.
//
// ⛔ WHY THESE TWO ARE WORTH THEIR OWN FILE. The walk ends by itself, and an end one
//    wallet too early reports a funded wallet as one that does not exist; the number `use` writes
//    decides which address every later payment leaves from. Both fail QUIETLY — nothing throws,
//    a number is simply wrong — so each is driven here with a chain that answers from a table.
//
// ⛔ THE CHAIN AND THE SEALED LIST ARE SUPPLIED, NOT REACHED FOR. A test that read a live chain
//    could never be asked for the answers these commands exist to handle (a node that refuses, a
//    wallet with history and no balance), and a test that read a live file list would need a
//    server to hold it.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { walletList } from "../src/commands/wallet-list.ts";
import { walletUse } from "../src/commands/wallet-use.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { Network } from "../src/network.ts";
import { walletIndexOf, payingWalletIndex } from "../src/wallet-pay-index.ts";
import { SUI_COIN_TYPE, walCoinType, walletAddress, type ChainReader } from "../src/wallet.ts";
import { generateCode, grantConsents } from "./helpers.ts";
import { entry, startFakeDrive, withSandbox } from "./fake-drive.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

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
    for (const [key, value] of [["NMTS_CONFIG_DIR", before.dir], [CODE_ENV_VAR, before.code]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A chain that holds coins at these addresses and answers zero everywhere else. */
function chainOf(held: Readonly<Record<string, bigint>>, network: Network = "testnet") {
  const opened: string[] = [];
  const wal = walCoinType(network);
  return {
    opened,
    open(_network: Network, address: string): ChainReader {
      opened.push(address);
      return {
        async totalOf(coinType: string): Promise<bigint> {
          return coinType === SUI_COIN_TYPE ? (held[address] ?? 0n) : 0n;
        },
        // The WAL type is real on this chain; a zero is then a zero (`wallet.ts`).
        async knowsCoinType(coinType: string): Promise<boolean> {
          return coinType === wal || coinType === SUI_COIN_TYPE;
        },
      };
    },
  };
}

test("it lists the wallets this account has made, and marks the one that pays", async () => {
  await withAccount("wallet-list-made", async (code) => {
    const out = collect();
    const chain = chainOf({});
    const exit = await walletList({
      network: "testnet",
      write: out.write,
      openChain: chain.open,
      hasHistory: async () => false,
      readWalletSettings: async () => ({ active: 1, count: 3 }),
    });
    assert.equal(exit, 0);
    const text = out.lines.join("\n");
    for (const index of [0, 1, 2]) {
      const address = await walletAddress(code, index);
      assert.match(text, new RegExp(`^${index}\\s+${address}`, "m"), `wallet ${index} is not listed`);
    }
    // ⛔ ONE ROW SAYS "pays", AND IT IS THE ACCOUNT'S NUMBER — a list that marked none of them, or
    //    two of them, would leave the question this screen exists for unanswered.
    assert.equal(out.lines.filter((line) => line.endsWith("pays")).length, 1);
    assert.match(text, new RegExp(`^1\\s+${await walletAddress(code, 1)}.*pays$`, "m"));
    // A wallet nobody funded is still listed: it was made, and it is on the person's screen.
    assert.equal(out.lines.some((line) => line.startsWith("3 ")), false, "the gap was printed");
  });
});

test("⛔ a funded wallet past the made list is found, and the walk stops after the gap", async () => {
  await withAccount("wallet-list-found", async (code) => {
    const far = await walletAddress(code, 4);
    const chain = chainOf({ [far]: 7n });
    const out = collect();
    const exit = await walletList({
      network: "testnet",
      json: true,
      write: out.write,
      openChain: chain.open,
      hasHistory: async () => false,
      readWalletSettings: async () => ({ active: 0, count: 1 }),
    });
    assert.equal(exit, 0);
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const wallets: unknown = Reflect.get(parsed, "wallets");
    assert.ok(Array.isArray(wallets));
    // Wallet 0 (made) and wallet 4 (funded) — and none of the empty ones between or beyond.
    assert.deepEqual(wallets.map((w: unknown) => Reflect.get(Object(w), "index")), [0, 4]);
    // The walk went twenty past the last wallet it found and then stopped.
    assert.equal(Reflect.get(parsed, "scanned"), 25);
    assert.equal(chain.opened.length, 25);
  });
});

test("⛔ a wallet with history and no balance is in use — an emptied wallet is not a free number", async () => {
  await withAccount("wallet-list-history", async (code) => {
    const used = await walletAddress(code, 2);
    const out = collect();
    await walletList({
      network: "testnet",
      json: true,
      write: out.write,
      openChain: chainOf({}).open,
      hasHistory: async (_network, address) => address === used,
      readWalletSettings: async () => ({ active: 0, count: 1 }),
    });
    const wallets: unknown = Reflect.get(Object(JSON.parse(out.lines.join(""))), "wallets");
    assert.ok(Array.isArray(wallets));
    assert.deepEqual(wallets.map((w: unknown) => Reflect.get(Object(w), "index")), [0, 2]);
  });
});

test("⛔ a balance that could not be read is said as that, and the run exits non-zero", async () => {
  await withAccount("wallet-list-unread", async () => {
    const out = collect();
    const exit = await walletList({
      network: "testnet",
      write: out.write,
      openChain: () => ({
        async totalOf(): Promise<bigint> {
          throw new Error("the node did not answer");
        },
        async knowsCoinType(): Promise<boolean> {
          return true;
        },
      }),
      hasHistory: async () => false,
      readWalletSettings: async () => ({ active: 0, count: 1 }),
    });
    assert.equal(exit, 1, "an unanswered chain is not an empty wallet");
    assert.match(out.lines.join("\n"), /could not be read/);
  });
});

test("⛔ which wallet pays: the flag wins, the account's number is the default, and a bad number is refused", async () => {
  // `--wallet N` answers without reading anything — that is what makes it usable when the list
  // cannot be read at all.
  assert.equal(await payingWalletIndex({ wallet: "5", readActiveWallet: async () => 1 }), 5);
  assert.equal(await payingWalletIndex({ readActiveWallet: async () => 1 }), 1);
  for (const bad of ["-1", "2.5", "", " ", "one"]) {
    assert.throws(() => walletIndexOf(bad), (error: unknown) => error instanceof NmtsError && error.exitCode === 2);
  }
});

test("⛔ a file list that cannot be read REFUSES rather than falling back to the first wallet", async () => {
  const failure = await payingWalletIndex({
    readActiveWallet: async () => {
      throw new Error("the list did not come back");
    },
  }).then(
    () => null,
    (error: unknown) => error,
  );
  // ⛔ THE POINT OF THE WHOLE FILE. Falling back to wallet 0 here would sign with a wallet nobody
  //    chose, after printing a review naming its address — and with --yes it would spend from it.
  assert.ok(failure instanceof NmtsError, "it fell back instead of refusing");
  assert.match(failure.message, /could not be read/);
  assert.match(String(failure.nextStep), /--wallet/);
});

// ── choosing the wallet that pays ──────────────────────────────────────────────────────────────
//
// ⛔ ASSERTED THROUGH THE SEALED LIST, not through what the command said. The number lives in the
//    blob or nowhere, and a settings field that is declared but carried by neither direction of
//    the codec is a defect this format has shipped before: every save dropped it, silently.

const drive = await startFakeDrive();
after(() => drive.close());

const useOpts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

test("`wallet use N` writes the number into the sealed list, and the paying side reads it back", async () => {
  await withSandbox(drive, "wallet-use-set", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await walletUse("2", useOpts(out)), 0);
    assert.match(out.lines.join("\n"), /^Wallet 2 pays from now on\.$/m);
    assert.match(out.lines.join("\n"), new RegExp(`^Address  ${await walletAddress(code, 2)}$`, "m"));
    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);

    // ⛔ Read back through the blob the tool actually sent — and read by the SAME function every
    //    spending command uses, so this is the number a payment would leave from.
    assert.equal(await payingWalletIndex({ server: drive.base, network: "testnet" }), 2);

    // Naming it again changes nothing: a no-op costs a version bump every device must download.
    const again = collect();
    assert.equal(await walletUse("2", useOpts(again)), 0);
    assert.deepEqual(again.lines.slice(0, 1), ["Wallet 2 was already the one that pays. Nothing changed."]);
    assert.equal(drive.written.length, 1, "the second run rewrote the list for nothing");
  });
});

test("⛔ a number that is not a number is refused before anything is read or written", async () => {
  await withSandbox(drive, "wallet-use-bad", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    for (const bad of [undefined, "", "-1", "two"]) {
      await assert.rejects(
        walletUse(bad, useOpts(collect())),
        (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
      );
    }
    assert.equal(drive.written.length, 0, "a command line to fix reached the server");
  });
});
