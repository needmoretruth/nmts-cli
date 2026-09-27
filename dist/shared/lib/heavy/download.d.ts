import type { HeavyCopy } from "../api/types-heavy.ts";
import { type FilecoinChain } from "../filecoin/providers.ts";
/** Inclusive start, exclusive end — the same shape the Walrus reads use. */
export interface HeavyByteRange {
    start: number;
    end?: number;
}
/** Why one copy was not used. */
export type HeavyCopySkip = "not_https" | "host_not_allowed" | "not_found" | "http_error" | "network_error";
export interface HeavyCopyAttempt {
    providerId: string;
    reason: HeavyCopySkip;
    /** The HTTP status, when an answer was the reason. */
    status?: number;
}
/**
 * Every copy failed. `notFound` is true only when every company actually asked answered 404 — one
 * that was down or erred may still hold the piece, which is the same rule the Walrus reads keep.
 */
export declare class HeavyDownloadError extends Error {
    readonly pieceCid: string;
    readonly attempts: readonly HeavyCopyAttempt[];
    readonly notFound: boolean;
    constructor(pieceCid: string, attempts: readonly HeavyCopyAttempt[]);
}
export interface FetchHeavyPartInput {
    /** The part's PieceCID — its `blob_id`. Used in messages only; each copy's address already names it. */
    pieceCid: string;
    /** The copies, in the order to try them. */
    copies: readonly HeavyCopy[];
    /** Which chain's allowlist the companies must be on. */
    chain: FilecoinChain;
    range?: HeavyByteRange;
    signal?: AbortSignal;
    /** Ask https companies outside the allowlist too (a program with no browser security policy). */
    allowUnlisted?: boolean;
    /** Default: the global `fetch`. */
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}
/**
 * Open a streaming read of one Heavy part from the first copy that serves it.
 *
 * Resolves with the response (status 200, or 206 for a range) whose body is the sealed part;
 * rejects with `HeavyDownloadError` when no copy serves it, or with the AbortError of `signal`.
 * A company that ignores `Range` and answers 200 with the whole part is accepted — the caller reads
 * only what it needs and cancels the rest.
 */
export declare function fetchHeavyPart(input: FetchHeavyPartInput): Promise<Response>;
