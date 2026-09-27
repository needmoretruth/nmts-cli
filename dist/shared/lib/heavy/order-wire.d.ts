import { type HeavyCopy, type HeavyRefusal } from "../api/types-heavy.ts";
/** Why a Heavy upload stopped, as a machine-readable word. */
export type HeavyFailure = 
/** A sealed part is under 127 bytes. The caller pads the plaintext and tries again. */
"piece_too_small"
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
export declare class HeavyOrderError extends Error {
    readonly reason: HeavyFailure;
    /** The contract refusal behind `refused` or `payment_refused`, when there was one. */
    readonly refusal: HeavyRefusal | null;
    readonly orderId: string | null;
    readonly slot: number | null;
    constructor(reason: HeavyFailure, message: string, details?: {
        refusal?: HeavyRefusal | null;
        orderId?: string | null;
        slot?: number | null;
        cause?: unknown;
    });
}
export declare function abortError(): DOMException;
export declare function isAbort(err: unknown): boolean;
/** The error's string `code`, if it has one. */
export declare function codeOf(err: unknown): string | null;
/**
 * A failure that says nothing about the request itself — the line dropped, the server had a bad
 * moment, or a limiter answered without a named reason — so the same call may simply be made again.
 * A named refusal never is: asking again gets the same answer.
 */
export declare function isTransient(err: unknown): boolean;
/** Wait `ms`, rejecting with an AbortError as soon as `signal` aborts. */
export declare function defaultSleep(ms: number, signal?: AbortSignal): Promise<void>;
export declare function isHttpsUrl(value: unknown): value is string;
/** A stored slot's copies, checked field by field; `null` when the answer is not usable. */
export declare function readCopies(raw: unknown): HeavyCopy[] | null;
