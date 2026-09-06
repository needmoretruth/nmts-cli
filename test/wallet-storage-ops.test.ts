// `nmts wallet storage split|merge|transfer` — the resources are read and must be the wallet's,
// the browser's rules say what the contract allows, the dry run's refusal ends the run before
// anything is signed, the review comes before `--yes`, and the wallet unlock's scope is held.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { walletStorageOps, parseBytes } from "../src/commands/wallet-storage-ops.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { StorageOpShape, StorageOpsReads } from "../src/storage-control-chain.ts";
import { parseWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import type { SignStorageOp } from "../src/wallet-sign.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

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

const AT = Date.UTC(2026, 8, 6);
const TO = "0x" + "cd".repeat(32);
const A = { objectId: "0xa", sizeBytes: 4 * 1024 ** 3, startEpoch: 10, endEpoch: 20 };
const B = { objectId: "0xb", sizeBytes: 1024 ** 3, startEpoch: 10, endEpoch: 20 };
const C = { objectId: "0xc", sizeBytes: 4 * 1024 ** 3, startEpoch: 20, endEpoch: 30 };
const D = { objectId: "0xd", sizeBytes: 2 * 1024 ** 3, startEpoch: 25, endEpoch: 30 };

function reads(over: { refusal?: string; fee?: bigint | null } = {}): (network: string) => StorageOpsReads & { dryRuns: StorageOpShape[] } {
  const dryRuns: StorageOpShape[] = [];
  return () => ({
    dryRuns,
    async readStorage() {
      return { items: [A, B, C, D], currentEpoch: 12 };
    },
    async walrusPackageId() {
      return "0xpkg";
    },
    async dryRun(shape) {
      dryRuns.push(shape);
      return over.refusal !== undefined ? { feeMist: null, refusal: over.refusal } : { feeMist: over.fee === undefined ? 1_500_000n : over.fee, refusal: null };
    },
  });
}

function signer(): SignStorageOp & { shapes: StorageOpShape[] } {
  const sign = async (input: { shape: StorageOpShape }): Promise<string> => {
    sign.shapes.push(input.shape);
    return "DIGEST1";
  };
  sign.shapes = [] as StorageOpShape[];
  return sign;
}

function unlockWallet(scope: "storage" | "all"): void {
  writeWalletGrant(parseWalletGrant({ days: "7", scope }, new Date(AT), "t"));
}

const base = (out: { write: (line: string) => void }, r = reads(), sign = signer()) => ({
  network: "testnet",
  write: out.write,
  now: AT,
  storageReads: r,
  signStorage: sign,
});

async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

test("--size parses the listing's own units", () => {
  assert.equal(parseBytes("4096"), 4096);
  assert.equal(parseBytes("1.5 GiB"), Math.floor(1.5 * 1024 ** 3));
  assert.throws(() => parseBytes("lots"), NmtsError);
});

test("split by size: the review prices the exact shape and stops without --yes; --yes signs it under scope storage", async () => {
  await withAccount("storage-split", async () => {
    const r = reads();
    const sign = signer();
    const out = collect();
    const stopped = await refusal(walletStorageOps("split", ["0xa"], { ...base(out, r, sign), size: "1GiB" }));
    assert.equal(stopped.exitCode, 4);
    assert.match(String(stopped.nextStep), /--yes/);
    assert.deepEqual(r().dryRuns, [{ kind: "splitSize", objectId: "0xa", keepBytes: 1024 ** 3 }]);
    assert.equal(sign.shapes.length, 0, "it signed without --yes");
    assert.match(out.lines.join("\n"), /keeps 1\.00 GiB; a new resource of 3\.00 GiB/);

    unlockWallet("storage");
    assert.equal(await walletStorageOps("split", ["0xa"], { ...base(collect(), r, sign), size: "1GiB", yes: true }), 0);
    assert.deepEqual(sign.shapes, [{ kind: "splitSize", objectId: "0xa", keepBytes: 1024 ** 3 }]);
  });
});

test("split by epochs keeps the first n and refuses a cut outside the period", async () => {
  await withAccount("storage-split-epoch", async () => {
    unlockWallet("storage");
    const sign = signer();
    assert.equal(await walletStorageOps("split", ["0xa"], { ...base(collect(), reads(), sign), epochs: "3", yes: true }), 0);
    assert.deepEqual(sign.shapes, [{ kind: "splitEpoch", objectId: "0xa", splitEpoch: 13 }]);
    const bad = await refusal(walletStorageOps("split", ["0xa"], { ...base(collect()), epochs: "10", yes: true }));
    assert.equal(bad.exitCode, 2);
  });
});

test("merge: same period joins sizes, touching periods of one size join periods, anything else is refused with the reason", async () => {
  await withAccount("storage-merge", async () => {
    unlockWallet("storage");
    const sign = signer();
    assert.equal(await walletStorageOps("merge", ["0xa", "0xb"], { ...base(collect(), reads(), sign), yes: true }), 0);
    assert.equal(await walletStorageOps("merge", ["0xa", "0xc"], { ...base(collect(), reads(), sign), yes: true }), 0);
    assert.deepEqual(sign.shapes.map((s) => (s.kind === "fuse" ? s.how : s.kind)), ["amount", "periods"]);
    const no = await refusal(walletStorageOps("merge", ["0xb", "0xd"], { ...base(collect(), reads(), sign), yes: true }));
    assert.equal(no.exitCode, 4);
    assert.match(no.message, /cannot be joined/);
    assert.equal(sign.shapes.length, 2, "a refused pair was signed");
  });
});

test("⛔ the chain's refusal at the dry run ends the run before anything is signed", async () => {
  await withAccount("storage-dryrun-refused", async () => {
    unlockWallet("all");
    const sign = signer();
    const no = await refusal(walletStorageOps("transfer", ["0xa", TO], { ...base(collect(), reads({ refusal: "MoveAbort … 3" }), sign), yes: true }));
    assert.equal(no.exitCode, 4);
    assert.match(no.message, /would refuse/);
    assert.equal(sign.shapes.length, 0);
  });
});

test("⛔ transfer needs scope all; a resource the wallet does not hold, or a bad address, is refused before the chain", async () => {
  await withAccount("storage-transfer", async () => {
    const r = reads();
    const sign = signer();
    unlockWallet("storage");
    const scope = await refusal(walletStorageOps("transfer", ["0xa", TO], { ...base(collect(), r, sign), yes: true }));
    assert.match(scope.message, /storage only/);
    assert.equal(sign.shapes.length, 0);
    unlockWallet("all");
    const out = collect();
    assert.equal(await walletStorageOps("transfer", ["0xa", TO], { ...base(out, r, sign), yes: true }), 0);
    assert.deepEqual(sign.shapes, [{ kind: "transfer", objectId: "0xa", to: TO }]);
    assert.match(out.lines.join("\n"), /No file goes with it/);
    const missing = await refusal(walletStorageOps("transfer", ["0xzz", TO], { ...base(collect(), r, sign), yes: true }));
    assert.equal(missing.exitCode, 4);
    const addr = await refusal(walletStorageOps("transfer", ["0xa", "nope"], { ...base(collect(), r, sign), yes: true }));
    assert.equal(addr.exitCode, 2);
    assert.equal(r().dryRuns.filter((s) => s.kind === "transfer").length, 2, "a refused request reached the chain");
  });
});
