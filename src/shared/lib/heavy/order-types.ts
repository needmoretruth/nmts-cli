// The shapes an NMTS Heavy upload is described in: what the caller hands the orchestrator, what it
// injects, what it hears along the way and what it gets back (`order-runner.ts` runs it).
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.

import type {
  HeavyOrderApi,
  HeavyOrderCreated,
  HeavyPartCommit,
  HeavyPrice,
} from "../api/types-heavy.ts";
import type { HeavyPayment, HeavyRunFile } from "./order-plan.ts";

/** A sealed part as the sealer returns it: a Blob (may be disk-backed) or bytes in memory. */
export type SealedBytes = Blob | Uint8Array<ArrayBuffer>;

/** What the sealer is asked to seal. */
export interface HeavySealJob {
  fileKey: string;
  partIndex: number;
  slot: number;
  sealedLen: number;
}

/** The moments a caller can show. */
export type HeavyProgress =
  | { phase: "opened"; orderId: string; order: HeavyOrderCreated }
  | {
      phase: "sealing" | "hashing" | "placing" | "committing" | "stored";
      slot: number;
      fileKey: string;
      partIndex: number;
    }
  | {
      phase: "uploading";
      slot: number;
      fileKey: string;
      partIndex: number;
      sentBytes: number;
      totalBytes: number;
    }
  | { phase: "paying"; orderId: string; price: HeavyPrice }
  | { phase: "paid"; orderId: string; txDigest: string };

export interface HeavyRunDeps {
  api: HeavyOrderApi;
  seal: (job: HeavySealJob, signal?: AbortSignal) => Promise<SealedBytes>;
  /** The part's FRC-0069 PieceCID (`bafkzcib…`), e.g. `calculate` from `@filoz/synapse-core/piece`. */
  pieceCid: (bytes: SealedBytes) => Promise<string>;
  /** Upload to the company — `uploadPieceToProvider` in `sp-upload.ts`, with the caller's transport. */
  upload: (input: {
    serviceUrl: string;
    bytes: SealedBytes;
    pieceCid: string;
    signal?: AbortSignal;
    onProgress?: (sentBytes: number, totalBytes: number) => void;
  }) => Promise<void>;
  /** Wait `ms`, rejecting with an AbortError when `signal` aborts. Default: a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Milliseconds since some fixed point. Default: `Date.now`. */
  now?: () => number;
  /** A fresh idempotency key (16..64 of `[A-Za-z0-9_-]`). Default: a random UUID. */
  newIdempotencyKey?: () => string;
}

export interface HeavyRunOptions {
  files: readonly HeavyRunFile[];
  payment: HeavyPayment;
  /** Pass the key of an earlier run to reach the same order again; otherwise a new one is made. */
  idempotencyKey?: string;
  /** Slots worked on at once. Default 2. */
  concurrency?: number;
  /** First wait between order reads while a slot commits. Default 3 s; it grows by half each time. */
  pollIntervalMs?: number;
  /** Longest wait between order reads. Default 30 s. */
  pollMaxIntervalMs?: number;
  /** How long one slot may take from `uploaded` to `stored`. Default 60 minutes. */
  storeTimeoutMs?: number;
  /** Upload attempts per slot before giving up. Default 3. */
  uploadAttempts?: number;
  signal?: AbortSignal;
  onProgress?: (event: HeavyProgress) => void;
}

export interface HeavyRunResult {
  orderId: string;
  idempotencyKey: string;
  /** The Filecoin epoch every copy is kept until. */
  expiryEpoch: number;
  /** Credit orders: what was taken. */
  credits?: number;
  /** Wallet orders: the payment's Sui transaction digest. */
  txDigest?: string;
  /** Per file, in the order given: the parts to put in that file's `POST /v1/items`. */
  files: { key: string; parts: HeavyPartCommit[] }[];
}
