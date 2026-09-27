// How an NMTS Heavy upload fails, and how it reads what the server and the network hand back.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// The orchestrator (`order-runner.ts`) takes its api from the caller, so it cannot know the caller's
// error class. It reads errors by SHAPE instead — a string `code` (the server's error code, or a
// transport word such as NETWORK) and a number `status` — which both the browser's and the command
// line's api clients carry.

import { heavyRefusalOf, type HeavyCopy, type HeavyRefusal } from "../api/types-heavy.ts";

/** Why a Heavy upload stopped, as a machine-readable word. */
export type HeavyFailure =
  /** A sealed part is under 127 bytes. The caller pads the plaintext and tries again. */
  | "piece_too_small"
  /** A sealed part is over the per-piece limit. The caller cuts smaller parts. */
  | "piece_too_large"
  /** More parts than one order may hold, none at all, or parts not numbered 0..n-1. */
  | "slot_count"
  /** The sealer produced a different number of bytes than the order was opened for. */
  | "sealed_len_mismatch"
  /** The server refused a call; `refusal` names which refusal when it is one of the contract's. */
  | "refused"
  /** The server's answer did not have the shape the contract gives it. */
  | "bad_answer"
  /** Every upload attempt to the storage company failed. */
  | "upload_failed"
  /** The server reports the slot failed (or was removed) instead of stored. */
  | "slot_failed"
  /** The whole order failed or expired. */
  | "order_failed"
  /** The slot was not stored within the time allowed. */
  | "store_timeout"
  /** The server could not be reached, repeatedly. */
  | "unreachable"
  /** The wallet payment was sent but the server would not accept it. */
  | "payment_refused";

export class HeavyOrderError extends Error {
  readonly reason: HeavyFailure;
  /** The contract refusal behind `refused` or `payment_refused`, when there was one. */
  readonly refusal: HeavyRefusal | null;
  readonly orderId: string | null;
  readonly slot: number | null;
  constructor(
    reason: HeavyFailure,
    message: string,
    details: {
      refusal?: HeavyRefusal | null;
      orderId?: string | null;
      slot?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "HeavyOrderError";
    this.reason = reason;
    this.refusal = details.refusal ?? null;
    this.orderId = details.orderId ?? null;
    this.slot = details.slot ?? null;
  }
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

/** The error's string `code`, if it has one. */
export function codeOf(err: unknown): string | null {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string"
    ? err.code
    : null;
}

function statusOf(err: unknown): number | null {
  return typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
    ? err.status
    : null;
}

/**
 * A failure that says nothing about the request itself — the line dropped, the server had a bad
 * moment, or a limiter answered without a named reason — so the same call may simply be made again.
 * A named refusal never is: asking again gets the same answer.
 */
export function isTransient(err: unknown): boolean {
  if (isAbort(err)) return false;
  const code = codeOf(err);
  if (code !== null && heavyRefusalOf(code) !== null) return false;
  if (code === "NETWORK" || code === "INTERNAL" || code === "BAD_RESPONSE" || code === "RATE_LIMITED") {
    return true;
  }
  const status = statusOf(err);
  if (status !== null) return status >= 500;
  // A bare TypeError is what `fetch` throws when the line is down.
  return err instanceof TypeError;
}

/** Wait `ms`, rejecting with an AbortError as soon as `signal` aborts. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    // Not a URL at all — the same answer as "not https".
    return false;
  }
}

/** A stored slot's copies, checked field by field; `null` when the answer is not usable. */
export function readCopies(raw: unknown): HeavyCopy[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: HeavyCopy[] = [];
  for (const c of raw) {
    if (
      typeof c !== "object" ||
      c === null ||
      !("provider_id" in c && "data_set_id" in c && "piece_id" in c && "retrieval_url" in c)
    ) {
      return null;
    }
    const { provider_id, data_set_id, piece_id, retrieval_url } = c;
    if (
      typeof provider_id !== "string" ||
      typeof data_set_id !== "string" ||
      typeof piece_id !== "string" ||
      !isHttpsUrl(retrieval_url)
    ) {
      return null;
    }
    out.push({ provider_id, data_set_id, piece_id, retrieval_url });
  }
  return out;
}
