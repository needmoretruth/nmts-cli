// `nmts wallet storage buy` — a storage resource with no file: the term is chosen like an upload's,
// the price is read fresh, the dry run's refusal or a short wallet ends the run before anything is
// signed, the review comes before `--yes`, and the wallet unlock is held against the price and fee.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { walletStorageBuy } from "../src/commands/wallet-storage-buy.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { BuyReads } from "../src/storage-control.ts";
import type { StorageOpShape } from "../src/storage-control-chain.ts";
import { parseWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import type { SignStorageOp } from "../src/wallet-sign.ts";
import { generateCode, grantConsents } from "./helpers.ts";

async function withAccount(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  process.env[CODE_ENV_VAR] = await generateCode();
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [["NMTS_CONFIG_DIR", before.dir], [CODE_ENV_VAR, before.code]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const AT = Date.UTC(2026, 10, 10);
const MIB = 1024 * 1024;

/** A testnet-like chain: epoch 577, 53 epochs ahead, 3735 FROST per MiB per epoch. */
function chain(over: { wal?: bigint; refusal?: string } = {}): BuyReads & { dryRuns: StorageOpShape[] } {
  const dryRuns: StorageOpShape[] = [];
  return {
    dryRuns,
    async readWindow() {
      return { clock: { current: 577, durationMs: 86_400_000, startedMs: AT }, maxAhead: 53 };
    },
    async price(sizeBytes, epochs) {
      return BigInt(Math.ceil(sizeBytes / MIB)) * 3735n * BigInt(epochs);
    },
    async readWallet() {
      return { sui: { read: true, baseUnits: 4_000_000_000n }, wal: { read: true, baseUnits: over.wal ?? 1_000_000_000n } };
    },
    async walrusPackageId() {
      return "0xpkg";
    },
    walType: () => "0xwal::wal::WAL",
    systemObjectId: () => "0xsystem",
    async dryRun(shape) {
      dryRuns.push(shape);
      return over.refusal === undefined ? { feeMist: 2_500_877n, refusal: null } : { feeMist: null, refusal: over.refusal };
    },
    async createdResource() {
      return "0xbought";
    },
  };
}

function signer(): SignStorageOp & { shapes: StorageOpShape[] } {
  const sign = async (input: { shape: StorageOpShape }): Promise<string> => {
    sign.shapes.push(input.shape);
    return "DIGEST1";
  };
  sign.shapes = [] as StorageOpShape[];
  return sign;
}

function lines(): { out: string[]; write: (line: string) => void } {
  const out: string[] = [];
  return { out, write: (line) => out.push(line) };
}

const base = (write: (line: string) => void, reads: BuyReads, sign: SignStorageOp) => ({
  network: "testnet",
  write,
  now: AT,
  buyReads: () => reads,
  signStorage: sign,
  readActiveWallet: async (): Promise<number> => 0,
});

async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

test("the review prices the exact shape and stops without --yes; --yes signs it under the unlock", async () => {
  await withAccount("storage-buy", async () => {
    const reads = chain();
    const sign = signer();
    const said = lines();
    const stopped = await refusal(walletStorageBuy({ ...base(said.write, reads, sign), size: "8MiB", epochs: "3" }));
    assert.equal(stopped.exitCode, 4);
    assert.match(String(stopped.nextStep), /--yes/);
    const shape = { kind: "buy", sizeBytes: 8 * MIB, epochs: 3, priceFrost: 89_640n, walType: "0xwal::wal::WAL", systemObjectId: "0xsystem" };
    assert.deepEqual(reads.dryRuns, [shape]);
    assert.equal(sign.shapes.length, 0, "it signed without --yes");
    const text = said.out.join("\n");
    assert.match(text, /8\.00 MiB for 3 epochs, epoch 577 to 580/);
    assert.match(text, /Storage 0\.00008964 WAL/);
    assert.match(text, /Chain fee about 0\.002500877 SUI/);

    // --yes without an unlock: refused at the gate, nothing signed.
    const locked = await refusal(walletStorageBuy({ ...base(lines().write, reads, sign), size: "8MiB", epochs: "3", yes: true }));
    assert.match(locked.message + String(locked.nextStep), /unlock/i);
    assert.equal(sign.shapes.length, 0, "it signed without the unlock");

    writeWalletGrant(parseWalletGrant({ days: "7", scope: "storage" }, new Date(AT), "t"));
    const json = lines();
    assert.equal(await walletStorageBuy({ ...base(json.write, reads, sign), size: "8MiB", epochs: "3", yes: true, json: true }), 0);
    assert.deepEqual(sign.shapes, [shape]);
    const done: unknown = JSON.parse(json.out.at(-1) ?? "{}");
    assert.ok(typeof done === "object" && done !== null);
    assert.deepEqual(
      [Reflect.get(done, "signed"), Reflect.get(done, "id"), Reflect.get(done, "digest"), Reflect.get(done, "endEpoch")],
      [true, "0xbought", "DIGEST1", 580],
    );
  });
});

test("--dry-run says what it would cost and exits 0 with nothing signed", async () => {
  await withAccount("storage-buy-dry", async () => {
    const sign = signer();
    const said = lines();
    assert.equal(await walletStorageBuy({ ...base(said.write, chain(), sign), size: "70254592", dryRun: true }), 0);
    assert.match(said.out.join("\n"), /for 2 epochs, epoch 577 to 579/);
    assert.match(said.out.join("\n"), /Nothing was signed/);
    assert.equal(sign.shapes.length, 0);
  });
});

test("⛔ a short wallet or the chain's refusal ends the run before the signature", async () => {
  await withAccount("storage-buy-short", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "storage" }, new Date(AT), "t"));
    const sign = signer();
    const poor = chain({ wal: 10n });
    const short = await refusal(walletStorageBuy({ ...base(lines().write, poor, sign), size: "8MiB", yes: true }));
    assert.match(short.message, /holds 0\.00000001 WAL/);
    assert.deepEqual(poor.dryRuns, [], "it asked the chain about a purchase the wallet cannot pay for");
    const refused = await refusal(walletStorageBuy({ ...base(lines().write, chain({ refusal: "MoveAbort 7" }), sign), size: "8MiB", yes: true }));
    assert.match(refused.message, /MoveAbort 7/);
    assert.equal(sign.shapes.length, 0);
  });
});

test("⛔ a size that is not a positive number of bytes, or no size, is refused before the chain is read", async () => {
  await withAccount("storage-buy-size", async () => {
    const reads = chain();
    for (const size of [undefined, "0", "lots"]) {
      await refusal(walletStorageBuy({ ...base(lines().write, reads, signer()), size }));
    }
    assert.deepEqual(reads.dryRuns, []);
  });
});
