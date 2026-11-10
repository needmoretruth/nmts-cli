// What a small-file batch actually BUYS on the storage network when the person's own wallet pays
//   for it: a file uploaded alone pays the fixed part of a blob by itself.
//
// THE PHYSICS, FROM THE SDK'S OWN ARITHMETIC. `@mysten/walrus` computes a blob's encoded length as
//   metadata (n_shards × (n_shards × 32 × 2 + 32)) plus the slivers (RS2: (primary + secondary
//   symbols) × symbol size × n_shards), and that function is not exported from the package index, so
//   the same arithmetic is written here and pinned by test to the SDK's numbers at 1,000 shards:
//   0 B → 66,034,000 · 500 KiB → 68,036,000 · 1 MiB → 70,038,000 · 1 GiB → 4,888,852,000.
//   So an empty blob already costs 63.0 MiB, a 500 KiB file alone 64.9 MiB, and 400 such files in
//   one batch about 2.3 MiB each. The batch on the pending panel is ONE blob (a quilt), so the fixed
//   part is paid once per press of the upload button, however many files are in it.
//
// ⛔ WALLET RAIL ONLY. On the credit rail the person pays for encrypted bytes at 1 credit per
//    MiB·28 days and the treasury carries the coding and the fixed part, so this number
//    would be false there. The panel shows this line only when the wallet is the chosen purse.
//
// ⚠ AN ESTIMATE, NOT THE QUOTE. The signed quote at register time is the price; this is the same
//   arithmetic ahead of it so the person can change their mind before pressing. Both networks run
//   1,000 shards today; the count is a parameter so a move shows up as one number, not a rewrite.

const DIGEST_LEN = 32;
const BLOB_ID_LEN = 32;

/** Shards on the Walrus networks NMTS uses (mainnet and testnet both, measured 2026-09-03). */
export const N_SHARDS = 1_000;

/** `encodedBlobLength` as the SDK computes it for RS2 encoding. */
export function encodedBlobLength(unencodedLength: number, nShards: number = N_SHARDS): number {
  if (!Number.isFinite(unencodedLength) || unencodedLength < 0) {
    throw new RangeError(`unencodedLength must be a non-negative finite number, got ${String(unencodedLength)}`);
  }
  const maxFaulty = Math.floor((nShards - 1) / 3);
  const minCorrect = nShards - maxFaulty;
  const primary = minCorrect - maxFaulty;
  const secondary = minCorrect;
  let symbolSize = Math.floor((Math.max(unencodedLength, 1) - 1) / (primary * secondary)) + 1;
  if (symbolSize % 2 === 1) symbolSize += 1;
  const slivers = (primary + secondary) * symbolSize * nShards;
  return nShards * (nShards * DIGEST_LEN * 2 + BLOB_ID_LEN) + slivers;
}

export interface WalletStorageEstimate {
  /** Raw bytes of the files in the batch. */
  rawBytes: number;
  /** What an empty blob already costs — the part every batch carries whatever is in it. */
  fixedBytes: number;
  /** Bytes the batch buys in total, coding and fixed part included. */
  boughtBytes: number;
  /** How much of what is bought is the fixed part — near 1 for one small file. */
  fixedShare: number;
}

/** What one batch (one blob) buys for `rawBytes` of files. */
export function estimateWalletStorage(rawBytes: number): WalletStorageEstimate {
  const fixedBytes = encodedBlobLength(0);
  const boughtBytes = encodedBlobLength(rawBytes);
  return { rawBytes, fixedBytes, boughtBytes, fixedShare: fixedBytes / boughtBytes };
}
