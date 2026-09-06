import { NOTICE_DAYS, NOTICE_EPOCHS, URGENT_DAYS, URGENT_EPOCHS, type DaysLeft } from "./shared/lib/extend/epochs.ts";
export { NOTICE_DAYS, NOTICE_EPOCHS, URGENT_DAYS, URGENT_EPOCHS };
export type { DaysLeft };
/** Where the storage network's clock stands. Built by `epochClock`, never assembled by hand. */
export interface EpochClock {
    /** The epoch the network is in. */
    readonly current: number;
    /** One epoch's length in milliseconds — read from the network, never assumed. */
    readonly durationMs: number;
    /** When the current epoch began, or null when the network did not say. */
    readonly startedMs: number | null;
}
/**
 * A clock, or null when what the network answered cannot be counted with.
 *
 * ⛔ THE INVARIANT LIVES IN THE TYPE, so every function below can divide by `durationMs` without
 *    asking again. A zero or a NaN out of a chain read would otherwise become an Infinity printed
 *    as a number of days, and there would be no single place to have caught it.
 */
export declare function epochClock(current: number, durationMs: number, startedMs: number | null): EpochClock | null;
/**
 * How far ahead a warning stage reaches, in epochs: a floor in days and a floor in epochs, wider
 * one wins.
 *
 * The day count rounds UP, because arriving a tick late is the quiet failure the whole surface
 * exists to prevent.
 */
export declare function warningEpochs(clock: EpochClock, days: number, floorEpochs: number): number;
/**
 * Whole days from `nowMs` until `epoch` is reached, by the network's own clock.
 *
 * With an anchor both ends collapse onto one moment. Without one, the honest answer is the
 * earliest the epoch can arrive — see the header for why the other edge is never used.
 */
export declare function daysLeftUntilEpoch(clock: EpochClock, epoch: number, nowMs: number): DaysLeft;
/**
 * How much trouble one file's storage term is in.
 *
 * `lapsed` is not a prediction: the term ran out and the bytes may already be unreadable. It is
 * kept separate from `urgent` because the action differs — an urgent file can still be extended,
 * a lapsed one usually cannot.
 */
export type ExpiryStage = "unrecorded" | "lapsed" | "urgent" | "soon" | "later";
export declare function stageOf(clock: EpochClock, expiryEpoch: number, nowMs: number): ExpiryStage;
/**
 * The epoch to ask the server about: everything ending before this is inside the warning window.
 *
 * The cutoff is computed HERE and sent as an absolute number because the server does not read the
 * chain and cannot work it out — `GET /v1/items/expiring` takes the answer, not the question.
 */
export declare function warningCutoffEpoch(clock: EpochClock): number;
/**
 * How long is left, said the way a person reads it.
 *
 * ⚠ "or more" is not hedging: it is the difference between a measurement and a floor, and dropping
 *   it would turn a lower bound into a promise about a deletion date.
 */
export declare function daysLeftInWords(left: DaysLeft): string;
