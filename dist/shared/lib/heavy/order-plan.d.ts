import type { HeavyPay, HeavyPrice, HeavySlotRequest } from "../api/types-heavy.ts";
/**
 * How much plaintext one Heavy part carries at most: 512 MiB.
 *
 * WHY THIS NUMBER. A storage company takes at most 1,065,353,216 bytes in one piece. A 512 MiB part
 * seals to 512 MiB plus about 2 KiB (a 72-byte header and a 16-byte tag per 4 MiB chunk), and size
 * padding never grows a part past its own power of two, so a full part stays near half the limit
 * whatever padding is chosen. It is also what a browser tab can hold comfortably while it hashes the
 * part and sends it.
 */
export declare const HEAVY_PART_SIZE_BYTES: number;
/** A sealed part may be no smaller than this (a Filecoin piece's minimum)… */
export declare const HEAVY_PIECE_MIN_BYTES = 127;
/** …and no larger than this (the storage companies' limit per piece). */
export declare const HEAVY_PIECE_MAX_BYTES = 1065353216;
/**
 * The least plaintext that seals to a legal piece: 127 − the 72-byte header − one 16-byte tag. A
 * part shorter than this is padded (the same size padding the format already has) before sealing.
 */
export declare const HEAVY_MIN_SEAL_FROM_BYTES: number;
/** Slots one order may hold. */
export declare const HEAVY_MAX_SLOTS = 256;
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
export type HeavyPayment = {
    pay: "credits";
} | {
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
export declare function planSlots(files: readonly HeavyRunFile[]): SlotPlan[];
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
export declare function heavyOrderRequest(files: readonly HeavyRunFile[], payment: HeavyPayment, idempotencyKey: string): HeavyOrderRequestBody;
