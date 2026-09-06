// The WALLET rail for ONE part: register (signature one), push the bytes at the relay, certify
// (signature two) — with the same written-down records the credit rail keeps.
//
// ⛔ THE ORDER IS WHAT STANDS BETWEEN AN INTERRUPTION AND MONEY THAT BOUGHT NOTHING, as in
//    `upload.ts`:
//
//      encode → WRITE IT DOWN → sign register (WAL and the tip leave here) → write it down again
//            → relay → sign certify (gas) → write it down again     … once per part …
//
//    Before the signature, so a retry has the sealed bytes and the tip nonce that reproduce the
//    blob the registration named. After it, so the transaction the relay checks its tip in, and
//    the blob object the certification names, are not lost with the process.
//
// ⛔ NOTHING IS SIGNED TWICE FOR ONE PART. A record carrying a register digest skips the register;
//    one carrying a certify digest skips everything. That is what makes running the same command
//    again cost nothing more — the same promise the credit rail makes with a reservation.
//
// ⛔ THE SIGNATURES ARE A SEAM. `wallet-sign.ts` is loaded by the command, after the agreement,
//    and handed in; the tests hand in recorders and prove that `--dry-run` and a shortfall never
//    reach them.

import { NmtsError } from "./errors.ts";
import type { Network } from "./network.ts";
import { readReservationBytes, readReservationRecord, writeReservation, type Reservation } from "./upload-store.ts";
import type { PartQuote, StorageChoice } from "./upload-wallet-plan.ts";
import { UploadError, type BlobMeta, type Certificate, type PaidPart, type UploadInput } from "./upload-wire.ts";
import type { Spend } from "./wallet-grant.ts";
import type { SignBlobCertify, SignBlobRegister } from "./wallet-sign.ts";

export interface WalletRailContext {
  network: Network;
  /** ⛔ The NMTS key. Held for the signatures and never written anywhere. */
  code: string;
  relayUrl: string;
  epochs: number;
  /** Where the storage comes from. A held resource serves one blob, so it applies to a one-part file. */
  storage: StorageChoice;
  /** What each part was quoted, in part order — what the grant ledger is told after each signature. */
  quotes: readonly PartQuote[];
  /** The measured register fee, added to the ledger with the tip; null adds the tip alone. */
  feeMist: bigint | null;
  signRegister: SignBlobRegister;
  signCertify: SignBlobCertify;
  /** Told what left the wallet, after each signature. */
  onSpend: (spend: Spend) => void;
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The rail: what `uploadFile` calls once per part. */
export function walletRail(ctx: WalletRailContext): (input: UploadInput) => Promise<PaidPart> {
  return (input) => buyAndPushPartWithWallet(ctx, input);
}

async function buyAndPushPartWithWallet(ctx: WalletRailContext, input: UploadInput): Promise<PaidPart> {
  const { protocol, key, sealed, onStep } = input;
  const existing = readReservationRecord(key);

  if (existing !== null && existing.paidFrom !== "wallet") {
    throw new UploadError({
      phase: "reserve",
      message: "This upload was started with credits paying, and this run would pay from the wallet.",
      paid: existing.ledgerId !== undefined,
      nextStep:
        "Run it again without --pay wallet to finish it, or move the records in the uploads " +
        "directory aside to start over. Nothing was sent.",
    });
  }
  if (existing !== null && (existing.partIndex !== input.part.index || existing.partTotal !== input.part.total)) {
    throw new UploadError({
      phase: "reserve",
      message:
        `This upload was started as part ${existing.partIndex + 1} of ${existing.partTotal} and this ` +
        `run is treating it as part ${input.part.index + 1} of ${input.part.total}.`,
      paid: existing.registerTxDigest !== undefined,
      nextStep:
        "Run it again with the part size the first attempt used, or move the records in the " +
        "uploads directory aside to start over. Nothing was sent.",
    });
  }

  // ── already certified: nothing left to sign or send ──
  if (existing?.certifyTxDigest !== undefined) {
    onStep?.({ step: "resuming", ledgerId: 0, state: "certified" });
    return paidPart(existing, true);
  }

  // ── registered by an earlier run: push and certify, sign nothing twice ──
  if (existing?.registerTxDigest !== undefined && existing.blobObjectId !== undefined) {
    onStep?.({ step: "resuming", ledgerId: 0, state: "registered" });
    const certificate = await push(input, existing, existing.registerTxDigest, existing.blobObjectId, readReservationBytes(key));
    await certify(ctx, input, key, existing, certificate);
    return paidPart(readReservationRecord(key) ?? existing, true);
  }

  // ── fresh, or interrupted before the signature ──
  onStep?.({ step: "encoding", bytes: sealed.length });
  let meta: BlobMeta;
  try {
    meta = await protocol.computeMetadata({
      bytes: sealed,
      nonce: existing ? new Uint8Array(Buffer.from(existing.nonceB64, "base64url")) : undefined,
    });
  } catch (error) {
    throw new UploadError({
      phase: "encoding",
      message: `Could not prepare this file for the storage network: ${why(error)}`,
      paid: false,
      nextStep: "Nothing was sent and nothing was signed.",
    });
  }
  const record: Reservation = {
    attempt: existing?.attempt ?? 0,
    paidFrom: "wallet",
    blobId: meta.blobId,
    nonceB64: Buffer.from(meta.nonce).toString("base64url"),
    rootHashB64: Buffer.from(meta.rootHash).toString("base64url"),
    relayUrl: input.relayUrl,
    epochs: input.epochs,
    sealedLen: sealed.length,
    plaintextLen: input.entry.plaintextLen,
    partPlaintextLen: input.part.plaintextLen,
    partIndex: input.part.index,
    partTotal: input.part.total,
    dekWrapped: input.entry.dekWrapped,
    contentHashCt: input.entry.contentHashCt,
    name: input.entry.name,
    parentId: input.entry.parentId,
  };
  // ⛔ BEFORE THE SIGNATURE. See the module header.
  writeReservation(key, record, sealed);

  onStep?.({ step: "reserving" });
  const quote = ctx.quotes[input.part.index];
  if (quote === undefined) throw new NmtsError("unreachable: a part with no quote");
  let registered: { digest: string; blobObjectId: string; endEpoch: number };
  try {
    registered = await ctx.signRegister({
      network: ctx.network,
      code: ctx.code,
      relayUrl: input.relayUrl,
      epochs: ctx.epochs,
      storage: ctx.storage.kind === "buy" ? { kind: "buy" } : ctx.storage,
      part: { sealedLen: sealed.length, blobId: meta.blobId, rootHash: meta.rootHash, nonce: meta.nonce, blobDigest: meta.blobDigest },
    });
  } catch (error) {
    throw new UploadError({
      phase: "reserve",
      message: why(error),
      // ⛔ A refusal did not spend more than gas. A request that never got an answer MIGHT have
      //    registered — the record is on disk either way, and the next run reads the chain's
      //    answer through the same signature path rather than guessing here.
      paid: false,
      nextStep:
        error instanceof NmtsError && error.nextStep !== null
          ? error.nextStep
          : "If the transaction reached the chain the storage may be bought; running the same " +
            "command again finds the record and does not sign a second registration for a part " +
            "that has one.",
    });
  }
  record.registerTxDigest = registered.digest;
  record.blobObjectId = registered.blobObjectId;
  record.endEpoch = registered.endEpoch;
  writeReservation(key, record, sealed);
  ctx.onSpend({
    walFrost: quote.writeFrost + (ctx.storage.kind === "buy" ? quote.storageFrost : 0n),
    suiMist: quote.tipMist + (ctx.feeMist ?? 0n),
  });

  const certificate = await push(input, record, registered.digest, registered.blobObjectId, sealed);
  await certify(ctx, input, key, record, certificate);
  return paidPart(readReservationRecord(key) ?? record, false);
}

/** The bytes to the relay named in the register transaction. The storage is already bought. */
async function push(
  input: UploadInput,
  record: Reservation,
  registerTxDigest: string,
  blobObjectId: string,
  sealed: Uint8Array,
): Promise<Certificate> {
  input.onStep?.({ step: "uploading", relayUrl: record.relayUrl, bytes: sealed.length });
  try {
    return await input.protocol.uploadToRelay({
      blobId: record.blobId,
      bytes: sealed,
      nonce: new Uint8Array(Buffer.from(record.nonceB64, "base64url")),
      registerTxDigest,
      blobObjectId,
    });
  } catch (error) {
    throw new UploadError({
      phase: "uploading",
      message: `Uploading to the storage network failed: ${why(error)}`,
      paid: true,
      nextStep:
        "The storage is already bought and the tip is paid. Running the same command again pushes " +
        "the same bytes to the same relay and signs nothing more for it.",
    });
  }
}

/** The second signature. Gas only. Written down before returning so a rerun never certifies twice. */
async function certify(
  ctx: WalletRailContext,
  input: UploadInput,
  key: string,
  record: Reservation,
  certificate: Certificate,
): Promise<void> {
  if (record.blobObjectId === undefined) throw new NmtsError("unreachable: certifying a part with no blob object");
  input.onStep?.({ step: "certifying" });
  let digest: string;
  try {
    digest = await ctx.signCertify({
      network: ctx.network,
      code: ctx.code,
      relayUrl: record.relayUrl,
      blobId: record.blobId,
      blobObjectId: record.blobObjectId,
      certificate,
    });
  } catch (error) {
    throw new UploadError({
      phase: "certify",
      message: why(error),
      paid: true,
      nextStep:
        error instanceof NmtsError && error.nextStep !== null
          ? error.nextStep
          : "The bytes are on the network and the storage is bought. Running the same command again " +
            "certifies again, which costs gas and nothing else.",
    });
  }
  writeReservation(key, { ...record, certifyTxDigest: digest }, readReservationBytes(key));
  // The certify fee is not measured beforehand, so the ledger is told about the tip and the
  // register fee only — the review said so.
}

/** What the commit needs about a finished part — off the RECORD, never off the run. */
function paidPart(record: Reservation, resumed: boolean): PaidPart {
  return {
    partIndex: record.partIndex,
    ledgerId: null,
    blobId: record.blobId,
    sealedLen: record.sealedLen,
    resumed,
    ...(record.blobObjectId !== undefined ? { suiObjectId: record.blobObjectId } : {}),
    ...(record.endEpoch !== undefined ? { endEpoch: record.endEpoch } : {}),
  };
}
