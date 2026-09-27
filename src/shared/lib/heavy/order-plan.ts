// The sizes an NMTS Heavy part may have, and how an upload's parts become one order's slots.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.

import type { HeavyPay, HeavyPrice, HeavySlotRequest } from "../api/types-heavy.ts";
import { HeavyOrderError } from "./order-wire.ts";

/**
 * How much plaintext one Heavy part carries at most: 512 MiB.
 *
 * WHY THIS NUMBER. A storage company takes at most 1,065,353,216 bytes in one piece. A 512 MiB part
 * seals to 512 MiB plus about 2 KiB (a 72-byte header and a 16-byte tag per 4 MiB chunk), and size
 * padding never grows a part past its own power of two, so a full part stays near half the limit
 * whatever padding is chosen. It is also what a browser tab can hold comfortably while it hashes the
 * part and sends it.
 */
export const HEAVY_PART_SIZE_BYTES = 512 * 1024 * 1024;

/** A sealed part may be no smaller than this (a Filecoin piece's minimum)… */
export const HEAVY_PIECE_MIN_BYTES = 127;
/** …and no larger than this (the storage companies' limit per piece). */
export const HEAVY_PIECE_MAX_BYTES = 1_065_353_216;
/**
 * The least plaintext that seals to a legal piece: 127 − the 72-byte header − one 16-byte tag. A
 * part shorter than this is padded (the same size padding the format already has) before sealing.
 */
export const HEAVY_MIN_SEAL_FROM_BYTES = HEAVY_PIECE_MIN_BYTES - 72 - 16;
/** Slots one order may hold. */
export const HEAVY_MAX_SLOTS = 256;

/** One part of one file, before sealing. */
export interface HeavyRunPart {
  /** Its position in its file (0-based). */
  partIndex: number;
  /** The exact size it will seal to — the order is opened with this before anything is sealed. */
  sealedLen: number;
}

/** One file of the upload. */
export interface HeavyRunFile {
  /** The caller's own name for the file; it comes back on the result unchanged. */
  key: string;
  parts: readonly HeavyRunPart[];
}

/** How the upload is paid. */
export type HeavyPayment =
  | { pay: "credits" }
  | {
      pay: "wallet";
      /** `0x` + 64 hex — the Sui address that will send the WAL. */
      payer: string;
      /** 1..=365 days. */
      termDays: number;
      /** Send `price.wal_frost` FROST to `price.treasury`; resolve with the Sui transaction digest. */
      payWallet: (price: HeavyPrice, orderId: string) => Promise<string>;
    };

/** One slot of the order: which part of which file it carries. */
export interface SlotPlan {
  slot: number;
  fileIndex: number;
  fileKey: string;
  partIndex: number;
  sealedLen: number;
}

/**
 * Number the slots across the files (file by file, part by part), and refuse any part an order
 * could never take — before anything is opened, sealed or charged.
 */
export function planSlots(files: readonly HeavyRunFile[]): SlotPlan[] {
  const plans: SlotPlan[] = [];
  files.forEach((file, fileIndex) => {
    const parts = [...file.parts].sort((a, b) => a.partIndex - b.partIndex);
    if (parts.length === 0) {
      throw new HeavyOrderError("slot_count", `File "${file.key}" has no parts.`);
    }
    parts.forEach((part, position) => {
      if (part.partIndex !== position) {
        throw new HeavyOrderError(
          "slot_count",
          `File "${file.key}" has no part ${position}; its parts must be numbered 0..n-1.`,
        );
      }
      if (!Number.isSafeInteger(part.sealedLen) || part.sealedLen < HEAVY_PIECE_MIN_BYTES) {
        throw new HeavyOrderError(
          "piece_too_small",
          `Part ${part.partIndex} of "${file.key}" seals to ${part.sealedLen} bytes; a piece needs ` +
            `${HEAVY_PIECE_MIN_BYTES}. Pad it to at least ${HEAVY_MIN_SEAL_FROM_BYTES} bytes of plaintext.`,
        );
      }
      if (part.sealedLen > HEAVY_PIECE_MAX_BYTES) {
        throw new HeavyOrderError(
          "piece_too_large",
          `Part ${part.partIndex} of "${file.key}" seals to ${part.sealedLen} bytes; a piece holds ` +
            `at most ${HEAVY_PIECE_MAX_BYTES}.`,
        );
      }
      plans.push({
        slot: plans.length,
        fileIndex,
        fileKey: file.key,
        partIndex: part.partIndex,
        sealedLen: part.sealedLen,
      });
    });
  });
  if (plans.length === 0 || plans.length > HEAVY_MAX_SLOTS) {
    throw new HeavyOrderError(
      "slot_count",
      `An order holds 1..${HEAVY_MAX_SLOTS} parts; this upload has ${plans.length}.`,
    );
  }
  return plans;
}

/** The `POST /v1/heavy/orders` body for an upload — exactly what `runHeavyOrder` sends. */
export interface HeavyOrderRequestBody {
  idempotency_key: string;
  slots: HeavySlotRequest[];
  pay: HeavyPay;
  term_days?: number;
  payer?: string;
}

/**
 * Build the order request for an upload.
 *
 * Exposed so a screen can open the order early — a wallet order's answer carries the price to show
 * — and then run the upload under the SAME idempotency key, which reaches the same order again.
 * ⚠ A different body under the same key is refused (`idempotency_conflict`): if the person changes
 * the term, make a new key.
 */
export function heavyOrderRequest(
  files: readonly HeavyRunFile[],
  payment: HeavyPayment,
  idempotencyKey: string,
): HeavyOrderRequestBody {
  const slots = planSlots(files).map((p) => ({ slot: p.slot, sealed_len: p.sealedLen }));
  return payment.pay === "credits"
    ? { idempotency_key: idempotencyKey, slots, pay: "credits" }
    : {
        idempotency_key: idempotencyKey,
        slots,
        pay: "wallet",
        term_days: payment.termDays,
        payer: payment.payer,
      };
}
