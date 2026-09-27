import type { HeavyRunDeps, HeavyRunOptions, HeavyRunResult } from "./order-types.ts";
export { HEAVY_MAX_SLOTS, HEAVY_MIN_SEAL_FROM_BYTES, HEAVY_PART_SIZE_BYTES, HEAVY_PIECE_MAX_BYTES, HEAVY_PIECE_MIN_BYTES, heavyOrderRequest, type HeavyOrderRequestBody, type HeavyPayment, type HeavyRunFile, type HeavyRunPart, } from "./order-plan.ts";
export { HeavyOrderError, type HeavyFailure } from "./order-wire.ts";
export type { HeavyProgress, HeavyRunDeps, HeavyRunOptions, HeavyRunResult, HeavySealJob, SealedBytes, } from "./order-types.ts";
/**
 * Run one Heavy upload to the end. Resolves with the parts to commit; rejects with a
 * `HeavyOrderError`, or with an AbortError when `options.signal` aborts.
 */
export declare function runHeavyOrder(options: HeavyRunOptions, deps: HeavyRunDeps): Promise<HeavyRunResult>;
