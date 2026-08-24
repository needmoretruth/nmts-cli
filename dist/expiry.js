// When bought storage runs out — the arithmetic, with no network in it.
//
// ⛔ A DAY COUNT IS A FLOOR, NOT A MEASUREMENT, UNLESS THE NETWORK SAID WHEN THIS EPOCH BEGAN.
//    The storage network always reports which epoch it is in and usually nothing about how far
//    into it we are. Counting `(end - current)` whole epochs therefore assumes the current epoch
//    has not started yet — on a network whose epoch is fourteen days that overstates the runway by
//    up to fourteen days, and a file with 23 days left gets told it has 28. This tool is allowed
//    to warn early and is not allowed to warn late, so without an anchor the answer is
//    `(end - current - 1)` epochs and `exact` is false, which is what makes the caller print
//    "or more" instead of a flat number.
//
// ⛔ AND THE EPOCH COMPARISON DECIDES WHETHER A TERM HAS ENDED, never the day count. A lease that
//    ends AT the current epoch has no epoch left to be read in, while an unanchored clock can
//    still put a positive number of days beside it.
//
// ⛔ AN UNRECORDED PERIOD IS NOT A SHORT ONE. `expiry_epoch` is 0 for a file whose uploader could
//    not read the epoch clock, and 0 sorts below every real deadline — so a listing that ranked by
//    the number alone would put "we do not know" at the top of a list headed "about to be lost".
//    `stageOf` answers `unrecorded` for those and the caller keeps them apart.
//
// ⛔ THE ARITHMETIC IS NOT WRITTEN HERE ANY MORE (2026-08-24). It used to be a second
//    implementation of the browser's, with only the four thresholds machine-compared — and a
//    compared VALUE does not stop two programs computing different answers from it. The browser's
//    copy lived in a file that also imports its wallet client, which cannot follow into a
//    command-line package, so the pure half was split out there and is copied here byte for byte
//    (`shared/lib/extend/epochs.ts`). What is left in this file is the part the browser has no use
//    for: a validated clock, the stage a file is in, the cutoff to ask the server about, and the
//    words a person reads.
//
// PURE: no network, no SDK, no clock of its own — `nowMs` is always passed in. That is what lets
// `node --test` drive the branches a real network only reaches during an epoch change.
import { daysLeftUntilEpoch as sharedDaysLeftUntilEpoch, NOTICE_DAYS, NOTICE_EPOCHS, URGENT_DAYS, URGENT_EPOCHS, warningEpochs as sharedWarningEpochs, } from "./shared/lib/extend/epochs.js";
// ⛔ Re-exported under the same names: a caller has no reason to know which of the two files a
//    threshold came from, and making it know would be a second thing to keep in step.
export { NOTICE_DAYS, NOTICE_EPOCHS, URGENT_DAYS, URGENT_EPOCHS };
/**
 * A clock, or null when what the network answered cannot be counted with.
 *
 * ⛔ THE INVARIANT LIVES IN THE TYPE, so every function below can divide by `durationMs` without
 *    asking again. A zero or a NaN out of a chain read would otherwise become an Infinity printed
 *    as a number of days, and there would be no single place to have caught it.
 */
export function epochClock(current, durationMs, startedMs) {
    if (!Number.isSafeInteger(current) || current < 0)
        return null;
    if (!Number.isFinite(durationMs) || durationMs <= 0)
        return null;
    if (startedMs !== null && !Number.isFinite(startedMs))
        return null;
    return { current, durationMs, startedMs };
}
/**
 * How far ahead a warning stage reaches, in epochs: a floor in days and a floor in epochs, wider
 * one wins.
 *
 * The day count rounds UP, because arriving a tick late is the quiet failure the whole surface
 * exists to prevent.
 */
export function warningEpochs(clock, days, floorEpochs) {
    return sharedWarningEpochs(days, floorEpochs, clock.durationMs);
}
/**
 * Whole days from `nowMs` until `epoch` is reached, by the network's own clock.
 *
 * With an anchor both ends collapse onto one moment. Without one, the honest answer is the
 * earliest the epoch can arrive — see the header for why the other edge is never used.
 */
export function daysLeftUntilEpoch(clock, epoch, nowMs) {
    const left = sharedDaysLeftUntilEpoch(epoch, clock, nowMs);
    // ⛔ THE SHARED FUNCTION ANSWERS `null` FOR A CLOCK IT CANNOT DIVIDE BY, and this one cannot
    //    hand that back: every caller here is already past `epochClock`, which refuses such a clock
    //    at the boundary — that is the whole reason `EpochClock` is a type you cannot assemble by
    //    hand. So `null` here would mean the validator and the arithmetic disagree about what a
    //    usable clock is, and a wrong number of days on a screen about deletion is worse than a stop.
    if (left === null) {
        throw new Error("the storage network's clock passed validation and then could not be counted with");
    }
    return left;
}
export function stageOf(clock, expiryEpoch, nowMs) {
    // 0 is the column's "nothing was recorded" — see the header. Anything below it is a value no
    // network produced, and guessing at what it meant would be the same mistake in a smaller print.
    if (!Number.isFinite(expiryEpoch) || expiryEpoch <= 0)
        return "unrecorded";
    if (expiryEpoch <= clock.current)
        return "lapsed";
    if (expiryEpoch <= clock.current + warningEpochs(clock, URGENT_DAYS, URGENT_EPOCHS))
        return "urgent";
    if (expiryEpoch < clock.current + warningEpochs(clock, NOTICE_DAYS, NOTICE_EPOCHS))
        return "soon";
    return "later";
}
/**
 * The epoch to ask the server about: everything ending before this is inside the warning window.
 *
 * The cutoff is computed HERE and sent as an absolute number because the server does not read the
 * chain and cannot work it out — `GET /v1/items/expiring` takes the answer, not the question.
 */
export function warningCutoffEpoch(clock) {
    return clock.current + warningEpochs(clock, NOTICE_DAYS, NOTICE_EPOCHS);
}
/**
 * How long is left, said the way a person reads it.
 *
 * ⚠ "or more" is not hedging: it is the difference between a measurement and a floor, and dropping
 *   it would turn a lower bound into a promise about a deletion date.
 */
export function daysLeftInWords(left) {
    if (left.days < 0)
        return left.exact ? "already ended" : "may already have ended";
    if (left.days < 1)
        return left.exact ? "ends today" : "could end today";
    const days = `${left.days} day${left.days === 1 ? "" : "s"}`;
    return left.exact ? `${days} left` : `${days} or more left`;
}
