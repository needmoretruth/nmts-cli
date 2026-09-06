// The fixtures a WALLET-PAID upload is driven by: a storage network that answers instantly, the two
// signatures, and the one local file every run sends.
//
// ⛔ THEY LIVE HERE BECAUSE TWO FILES USE THEM, for the reason `fake-extend.ts` gives: what this
//    path DOES and what its standing tip does are separate files (the length gate is the honest
//    reason), and a second copy of the fake chain is how the two start disagreeing about what a
//    quote looks like.
//
// ⛔ THE QUOTE IS ARITHMETIC A TEST CAN PREDICT — `sealedLen × epochs` of storage plus `sealedLen`
//    of write — not a number read back out of the code under test. A fixture that asked the product
//    what the price should be would agree with any arithmetic at all, including the wrong one.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { put } from "../src/commands/put.ts";
import type { StorageResource } from "../src/shared/lib/storage-control/chain.ts";
import type { PartQuote, WalletUploadReads } from "../src/upload-wallet-plan.ts";
import type { CoinBalance } from "../src/wallet.ts";
import type { SignBlobCertify, SignBlobRegister } from "../src/wallet-sign.ts";
import type { FakeDrive } from "./fake-drive.ts";
import { FEE_MIST, MAINNET, NOW, PLENTY_SUI, PLENTY_WAL } from "./fake-extend.ts";
import { apiThat, protocolThat } from "./upload-fixture.ts";

/** The relay's tip, in MIST — one number, so a sum over parts is visibly a sum. */
export const TIP = 1_000n;

/** A file of ten bytes, written once for every run that sends one. */
const dir = mkdtempSync(join(tmpdir(), "nmts-put-wallet-"));
export const FILE = join(dir, "notes.txt");
writeFileSync(FILE, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

/** A chain that answers instantly: the quote is `sealedLen × epochs` storage plus `sealedLen` write. */
export function fakeReads(over: {
  wallet?: { wal?: bigint | null; sui?: bigint | null };
  gas?: bigint | null;
  resources?: StorageResource[];
  maxAhead?: number;
} = {}): WalletUploadReads & { calls: string[] } {
  const calls: string[] = [];
  const coin = (held: bigint | null | undefined, plenty: bigint): CoinBalance =>
    held === null ? { read: false, why: "the fake chain was told not to answer" } : { read: true, baseUnits: held ?? plenty };
  return {
    calls,
    async readWindow() {
      calls.push("readWindow");
      return { clock: MAINNET, maxAhead: over.maxAhead ?? 53 };
    },
    async quoteParts(lens, epochs) {
      calls.push(`quote ${lens.join(",")} ×${epochs}`);
      return lens.map(
        (sealedLen): PartQuote => ({ sealedLen, storageFrost: BigInt(sealedLen) * BigInt(epochs), writeFrost: BigInt(sealedLen), tipMist: TIP }),
      );
    },
    async readWallet() {
      calls.push("readWallet");
      return { wal: coin(over.wallet?.wal, PLENTY_WAL), sui: coin(over.wallet?.sui, PLENTY_SUI) };
    },
    async estimateRegisterGas({ storage }) {
      calls.push(`estimateGas ${storage.kind}`);
      return over.gas === undefined ? FEE_MIST : over.gas;
    },
    async readStorage() {
      calls.push("readStorage");
      return over.resources ?? [];
    },
    async encodedLength(_sender, sealedLen) {
      calls.push(`encodedLength ${sealedLen}`);
      // Five times the sealed size — the shape of the real number, not its value.
      return sealedLen * 5;
    },
  };
}

export type Asked = Parameters<SignBlobRegister>[0];

/** Signers that answer, and remember every shape they were handed. */
export function recordingSigners(): { register: SignBlobRegister; certify: SignBlobCertify; registered: Asked[]; certified: string[] } {
  const registered: Asked[] = [];
  const certified: string[] = [];
  return {
    registered,
    certified,
    register: async (input) => {
      registered.push(input);
      return { digest: `reg-${registered.length}`, blobObjectId: `0xblob-${registered.length}`, endEpoch: MAINNET.current + input.epochs };
    },
    certify: async (input) => {
      certified.push(input.blobObjectId);
      return `cert-${certified.length}`;
    },
  };
}

/** Signers that fail the test by existing. */
export function refuseToSign(what: string): { register: SignBlobRegister; certify: SignBlobCertify; calls: number } {
  const both = { calls: 0 };
  return {
    ...both,
    register: async () => {
      both.calls += 1;
      throw new Error(what);
    },
    certify: async () => {
      both.calls += 1;
      throw new Error(what);
    },
  };
}

/** The options every run shares: this drive, this moment, a chain that answers, and no real relay. */
export function putWalletOpts(
  drive: FakeDrive,
  out: { write: (line: string) => void },
  extra: Record<string, unknown> = {},
): Parameters<typeof put>[1] {
  const { api } = apiThat();
  return {
    server: drive.base,
    network: "testnet",
    write: out.write,
    pay: "wallet",
    now: NOW,
    readChain: () => fakeReads(),
    protocol: () => ({ ...protocolThat(), relayUrl: "https://relay.example" }),
    api,
    ...extra,
  };
}
