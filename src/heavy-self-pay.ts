// NMTS Heavy paid by the key's OWN EVM wallet — developer mode. Anything a developer could do with
// the Synapse SDK directly (how many copies, which storage companies, their own deposit) is done
// here through it, and the result is filed in the account like any other file.
//
// ⛔ NO ORDER AND NO TREASURY. The wallet's own Filecoin Pay deposit pays the storage companies;
//    the server only records where the copies are (`paid_by` = the 0x address, `owner_kind` 0) and
//    checks nothing about the payment, as it does for a Walrus wallet upload.
//
// ⛔ REFUSED BEFORE ANYTHING IS SPENT ON A CHAIN WITH NO LISTED COMPANY. Today that is mainnet:
//    `shared/lib/filecoin/providers.ts` has no mainnet rows, so self-paid Heavy is Calibration only.
//
// ⛔ THE SDK IS LOADED ONLY WHEN THIS RUNS (it pulls in viem, seconds in Node), never at start-up.
//
// ⚠ ITS REQUESTS DO NOT GO THROUGH `reachFetch`. The Synapse SDK makes its own RPC and storage
//   company calls; a proxy set on this package is not applied to them.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Account } from "viem";

import type { CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { commitHeavyItem, type HeavySelfPaidPart } from "./heavy-api.ts";
import { HEAVY_COPY } from "./heavy-copy.ts";
import { prepareHeavyFiles, sealHeavyPart, wipe, type HeavyCommitted, type HeavyFile } from "./heavy-upload.ts";
import type { Network } from "./network.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { FILECOIN_CHAIN_FOR_NETWORK, FILECOIN_PROVIDERS, type FilecoinChain } from "./shared/lib/filecoin/providers.ts";

/** Copies one self-paid part may ask for, and the default. */
export const SELF_PAY_MAX_COPIES = 12;
export const SELF_PAY_DEFAULT_COPIES = 2;

/** `--copies` as typed. Absent = 2. Refused, never clamped. */
export function copiesOf(raw: string | number | undefined): number {
  if (raw === undefined || raw === "") return SELF_PAY_DEFAULT_COPIES;
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1 || value > SELF_PAY_MAX_COPIES) {
    throw new NmtsError(HEAVY_COPY.badCopies(String(raw)), { exitCode: 2 });
  }
  return value;
}

/** `--providers 4,9` as registry ids. Absent = the SDK chooses. */
export function providersOf(raw: string | readonly (number | bigint)[] | undefined): bigint[] | undefined {
  if (raw === undefined || raw === "") return undefined;
  const parts = typeof raw === "string" ? raw.split(",").map((p) => p.trim()) : raw.map(String);
  if (parts.length === 0 || parts.some((p) => !/^[0-9]+$/u.test(p))) {
    throw new NmtsError(HEAVY_COPY.badProviders(String(raw)), { exitCode: 2 });
  }
  return parts.map((p) => BigInt(p));
}

/** Which Filecoin chain this NMTS network pays on — refused where no company is listed. */
export function selfPayChain(network: Network): FilecoinChain {
  const chain = FILECOIN_CHAIN_FOR_NETWORK[network];
  if (FILECOIN_PROVIDERS[chain].length === 0) {
    throw new NmtsError(HEAVY_COPY.evmNoProviders(chain), { exitCode: 4 });
  }
  return chain;
}

/** The Synapse client for one account on one chain. `account` may be a bare address for reads. */
export async function synapseFor(account: Account | `0x${string}`, chain: FilecoinChain) {
  const sdk = await import("@filoz/synapse-sdk");
  return sdk.Synapse.create({ account, source: "nmts", chain: chain === "mainnet" ? sdk.mainnet : sdk.calibration });
}

/** The phases a caller can show, per part. */
export type SelfPayProgress =
  | { phase: "sealing" | "uploading" | "stored"; fileIndex: number; partIndex: number; parts: number }
  | { phase: "sent"; fileIndex: number; partIndex: number; parts: number; sentBytes: number; totalBytes: number };

export interface SelfPayContext {
  server: string;
  bearer: string;
  crypt: CryptoGlue;
  /** Borrowed — the caller wipes it. */
  dataKey: Uint8Array;
  rule: PaddingRule;
  network: Network;
  /** The EVM account that pays and signs: this key's own (`evm_key_for`), or a business's. */
  account: Account;
  copies: number;
  providers?: readonly bigint[] | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((event: SelfPayProgress) => void) | undefined;
  /** ⚠ Seams, not options: the storage client and the commit, for tests. */
  synapse?: SelfPaySynapse | undefined;
  commit?: typeof commitHeavyItem | undefined;
}

/** The two things this path asks of the Synapse SDK. */
export interface SelfPaySynapse {
  upload(
    bytes: Uint8Array,
    options: { copies: number; providerIds?: bigint[]; signal?: AbortSignal; onProgress?: (sent: number) => void },
  ): Promise<{ pieceCid: string; copies: { providerId: bigint; dataSetId: bigint; pieceId: bigint; retrievalUrl: string }[] }>;
  /** The Filecoin epoch now, and how many more the deposit lasts at its current rate. */
  runway(): Promise<{ epoch: bigint; runwayInEpochs: bigint }>;
}

/** The real one: the Synapse SDK, over this account on this chain. */
export async function synapseSelfPay(account: Account, chain: FilecoinChain): Promise<SelfPaySynapse> {
  const synapse = await synapseFor(account, chain);
  return {
    async upload(bytes, options) {
      const result = await synapse.storage.upload(bytes, {
        copies: options.copies,
        ...(options.providerIds === undefined ? {} : { providerIds: options.providerIds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onProgress === undefined ? {} : { callbacks: { onProgress: options.onProgress } }),
      });
      return { pieceCid: result.pieceCid.toString(), copies: result.copies };
    },
    async runway() {
      const summary = await synapse.payments.accountSummary();
      return { epoch: summary.epoch, runwayInEpochs: summary.runwayInEpochs };
    },
  };
}

/** Filecoin epochs in 30 days — the lockup a storage company is always owed. */
const EPOCHS_PER_MONTH = 86_400n;

/**
 * The epoch the deposit pays through after this upload: the SDK's runway — what the deposit holds
 * BEYOND the lockup — and then the 30-day lockup the storage companies are owed. Counting only the
 * runway wrote a 28-day payment as ending in the epoch it was committed (mainnet, 2026-09-28).
 *
 * ⚠ A RATE OF ZERO HAS NO END (the SDK answers the largest uint256). That only happens when no
 *   piece is being paid for; the lockup alone is written then.
 */
export function expiryFrom(runway: { epoch: bigint; runwayInEpochs: bigint }): number {
  const funded = runway.runwayInEpochs > 2n ** 40n ? 0n : runway.runwayInEpochs;
  return Number(runway.epoch + funded + EPOCHS_PER_MONTH);
}

/** Upload these files from the key's own EVM wallet and commit each one. The caller writes the list. */
export async function heavySelfPut(
  ctx: SelfPayContext,
  files: readonly HeavyFile[],
): Promise<{ files: HeavyCommitted[]; expiryEpoch: number; paidBy: string; copies: number[] }> {
  const chain = selfPayChain(ctx.network);
  const synapse = ctx.synapse ?? (await synapseSelfPay(ctx.account, chain));
  const prepared = await prepareHeavyFiles(ctx.crypt, ctx.dataKey, ctx.rule, files);
  try {
    const partsPerFile: HeavySelfPaidPart[][] = [];
    const copyCounts: number[] = [];
    for (const [fileIndex, one] of prepared.entries()) {
      const parts: HeavySelfPaidPart[] = [];
      for (const part of one.plan) {
        const at = { fileIndex, partIndex: part.partIndex, parts: one.plan.length };
        ctx.onProgress?.({ phase: "sealing", ...at });
        const bytes = await sealHeavyPart(ctx.crypt, one, part);
        ctx.onProgress?.({ phase: "uploading", ...at });
        const stored = await synapse.upload(bytes, {
          copies: ctx.copies,
          ...(ctx.providers === undefined ? {} : { providerIds: [...ctx.providers] }),
          ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
          onProgress: (sent) => ctx.onProgress?.({ phase: "sent", ...at, sentBytes: sent, totalBytes: bytes.byteLength }),
        });
        if (stored.copies.length === 0) throw new NmtsError(HEAVY_COPY.evmNoCopy(stored.pieceCid), { exitCode: 1 });
        copyCounts.push(stored.copies.length);
        parts.push({
          part_index: part.partIndex,
          storage_kind: 0,
          network: 1,
          blob_id: stored.pieceCid,
          sealed_len: part.sealedLen,
          owner_kind: 0,
          expiry_epoch: 0,
          copies: stored.copies.map((c) => ({
            provider_id: c.providerId.toString(),
            data_set_id: c.dataSetId.toString(),
            piece_id: c.pieceId.toString(),
            retrieval_url: c.retrievalUrl,
          })),
        });
        ctx.onProgress?.({ phase: "stored", ...at });
      }
      partsPerFile.push(parts);
    }
    // ⛔ READ AFTER EVERY PART IS IN: the new pieces raise the rate, and the rate sets the end.
    const expiryEpoch = expiryFrom(await synapse.runway());
    const commit = ctx.commit ?? commitHeavyItem;
    const committed: HeavyCommitted[] = [];
    for (const [index, one] of prepared.entries()) {
      const parts = (partsPerFile[index] ?? []).map((p) => ({ ...p, expiry_epoch: expiryEpoch }));
      const itemId = await commit({
        server: ctx.server,
        bearer: ctx.bearer,
        // The pieces name the file: the same pieces committed again are the same file.
        idempotencyKey: `nmts-heavy-self-${bytesToHex(sha256(new TextEncoder().encode(parts.map((p) => p.blob_id).join(",")))).slice(0, 40)}`,
        dekWrapped: one.secrets.dekWrapped,
        contentHashCt: one.secrets.contentHashCt,
        parts,
        paidBy: ctx.account.address,
      });
      committed.push({
        itemId,
        name: one.file.name,
        parentId: one.file.parentId,
        destination: one.file.destination,
        plaintextLen: one.file.source.size,
        dekWrapped: one.secrets.dekWrapped,
        contentHashCt: one.secrets.contentHashCt,
        sealedBytes: one.plan.reduce((sum, p) => sum + p.sealedLen, 0),
        parts: one.plan.length,
      });
    }
    return { files: committed, expiryEpoch, paidBy: ctx.account.address, copies: copyCounts };
  } finally {
    wipe(prepared);
  }
}
