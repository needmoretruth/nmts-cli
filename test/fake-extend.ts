// The fixtures `nmts extend` is driven by: a storage network that answers instantly, and two
// signers — one that fails the test by being called, one that answers a digest and remembers what
// it was asked to sign.
//
// ⛔ THEY LIVE HERE BECAUSE TWO FILES USE THEM. The tests for what this command DOES and the tests
//    for what it REFUSES are separate files (the length gate is the honest reason, and that is the
//    line worth splitting on), and a second copy of the fake chain is how the two start disagreeing
//    about what a lease looks like.
//
// ⛔ THE QUOTE IS ARITHMETIC A TEST CAN PREDICT, not a number read back out of the code under
//    test. A fixture that asked the product what the price should be would agree with any
//    arithmetic at all, including the wrong one.

import { strict as assert } from "node:assert";

import type { extend } from "../src/commands/extend.ts";
import { testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { epochClock, type EpochClock } from "../src/expiry.ts";
import type { BlobLease, ExtendReads, SignExtension } from "../src/extend-plan.ts";
import type { CoinBalance } from "../src/wallet.ts";
import { entry, folder, withSandbox, type FakeDrive } from "./fake-drive.ts";
import { grantConsents } from "./helpers.ts";

const DAY = 86_400_000;

/** The instant every test measures against, so one run reports one moment. */
export const NOW = Date.UTC(2026, 7, 24);

/** A clock, refusing to be built out of numbers the product itself would reject. */
export function clockOf(current: number, epochDays: number, startedMs: number | null): EpochClock {
  const clock = epochClock(current, epochDays * DAY, startedMs);
  assert.ok(clock !== null, "the fixture built a clock the product would have refused");
  return clock;
}

/** Mainnet's shape: a fortnight to the epoch, and no anchor — which is the usual state. */
export const MAINNET = clockOf(1200, 14, null);

/** Two blobs, so a price is a sum and not a copy of one number. */
export const LEASES: BlobLease[] = [
  { objectId: "0xblob-a", size: 1_000_000, endEpoch: 1202 },
  { objectId: "0xblob-b", size: 500_000, endEpoch: 1204 },
];

/** The preview the server sends for a file on those blobs. */
export function preview(targets: readonly BlobLease[] = LEASES): unknown {
  return {
    item_id: "a",
    targets: targets.map((lease) => ({
      sui_object_id: lease.objectId,
      storage_kind: 0,
      expiry_epoch: lease.endEpoch,
      shared_items: 1,
    })),
    treasury_parts: 0,
    untracked_parts: 0,
  };
}

export interface FakeChain extends ExtendReads {
  /** Every read this run made, in order — so a test can see what happened before what. */
  readonly calls: string[];
}

/**
 * A storage network that answers instantly and never changes its mind.
 *
 * The quote is `size × epochs` base units unless `priceFrost` overrides it, which is how a test
 * puts an amount past what a JavaScript number holds through the machine-readable answer.
 */
export function fakeChain(
  over: {
    clock?: EpochClock;
    maxAhead?: number;
    leases?: BlobLease[];
    priceFrost?: bigint;
    /** What the wallet holds. `null` = could not be read. Default: plenty of both. */
    wallet?: { wal?: bigint | null; sui?: bigint | null };
    /** The dry-run fee in MIST. `null` = could not be measured. Default: 0.003 SUI. */
    gas?: bigint | null;
  } = {},
): FakeChain {
  const calls: string[] = [];
  return {
    calls,
    async readWindow() {
      calls.push("readWindow");
      return { clock: over.clock ?? MAINNET, maxAhead: over.maxAhead ?? 53 };
    },
    async readLeases(ids: readonly string[]) {
      calls.push(`readLeases ${ids.join(",")}`);
      return (over.leases ?? LEASES).filter((lease) => ids.includes(lease.objectId));
    },
    async quote(leases: readonly BlobLease[], epochs: number) {
      calls.push(`quote ${epochs}`);
      if (over.priceFrost !== undefined) return over.priceFrost;
      return leases.reduce((sum, lease) => sum + BigInt(lease.size) * BigInt(epochs), 0n);
    },
    async readWallet(address: string) {
      calls.push("readWallet");
      void address;
      const coin = (held: bigint | null | undefined, plenty: bigint): CoinBalance =>
        held === null ? { read: false, why: "the fake chain was told not to answer" } : { read: true, baseUnits: held ?? plenty };
      return { wal: coin(over.wallet?.wal, PLENTY_WAL), sui: coin(over.wallet?.sui, PLENTY_SUI) };
    },
    async estimateGas({ epochs }) {
      calls.push(`estimateGas ${epochs}`);
      return over.gas === undefined ? FEE_MIST : over.gas;
    },
  };
}

/** Enough WAL for any price a test below quotes, and enough SUI for any fee. */
export const PLENTY_WAL = 10_000_000_000_000_000n;
export const PLENTY_SUI = 1_000_000_000n;
/** The fee the fake dry run measures — 0.003 SUI. */
export const FEE_MIST = 3_000_000n;

/** A signer that fails the test by existing. Used wherever nothing may be signed. */
export function refuseToSign(what: string): SignExtension & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error(what);
  };
  sign.calls = 0;
  return sign;
}

/** A signer that answers a digest, and remembers what it was asked to sign. */
export function recordingSigner(): SignExtension & {
  asked: { objectIds: readonly string[]; epochs: number }[];
} {
  const asked: { objectIds: readonly string[]; epochs: number }[] = [];
  const sign = async (input: { objectIds: readonly string[]; epochs: number }): Promise<string> => {
    asked.push({ objectIds: input.objectIds, epochs: input.epochs });
    return DIGEST;
  };
  sign.asked = asked;
  return sign;
}

/** The digest `recordingSigner` answers — shaped like a real one, so nothing refuses it early. */
export const DIGEST = "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz";

/** The options every run below shares: this drive, this moment, and a chain that answers. */
export function extendOpts(
  drive: FakeDrive,
  out: { write: (line: string) => void },
  extra: Partial<Parameters<typeof extend>[1]> = {},
): Parameters<typeof extend>[1] {
  return {
    server: drive.base,
    network: "testnet",
    write: out.write,
    now: NOW,
    readChain: () => fakeChain(),
    ...extra,
  };
}

/** The refusal a run produced, or a failed assertion saying it did not refuse at all. */
export async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

/** A sandbox where signing HAS been agreed to on this machine. */
export async function withWalletAgreed(
  drive: FakeDrive,
  name: string,
  body: (code: string) => Promise<void>,
): Promise<void> {
  await withSandbox(drive, name, async (code) => {
    grantConsents(testConfigDir(name), "plain-env", "wallet");
    await body(code);
  });
}

/** One file, on the two leases above, in a folder — the fixture the runs start from. */
export async function servePhoto(drive: FakeDrive, code: string): Promise<void> {
  await drive.serve(code, [
    folder({ id: "F", name: "photos" }),
    entry({ id: "a", name: "a.jpg", parentId: "F", size: 4_000_000 }),
  ]);
  drive.extendPreview = preview();
}
