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
// ⚠ THE BROWSER HOLDS THE SAME RULES, and the four thresholds below are machine-compared against
//   its copies. The arithmetic around them is a second implementation rather than the copied
//   module every other shared rule in this package uses: the browser's lives in a file that also
//   imports its wallet client, which cannot follow it into a command-line package.
//
// PURE: no network, no SDK, no clock of its own — `nowMs` is always passed in. That is what lets
// `node --test` drive the branches a real network only reaches during an epoch change.
const DAY_MS = 24 * 60 * 60 * 1000;
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
 * Warn from here on, in two stages: a plain note, then an urgent one.
 *
 * Each stage is a floor in DAYS and a floor in EPOCHS, and the wider one wins (`warningEpochs`).
 * Counted in days alone, a fourteen-day epoch makes the whole warning exactly one epoch wide, so
 * somebody who runs this monthly never sees it. Counted in epochs alone, a one-day epoch shrinks
 * the same warning from fourteen days to three.
 *
 * ⛔ They must match the browser's, which draws the same warning over the same files for the same
 *    account: `web/src/lib/extend/chain.ts::NOTICE_DAYS`,
 *    `web/src/lib/extend/chain.ts::NOTICE_EPOCHS`, `web/src/lib/extend/chain.ts::URGENT_DAYS` and
 *    `web/src/lib/extend/chain.ts::URGENT_EPOCHS`. Two tools disagreeing about when a file is in
 *    danger is worse for the person than either threshold on its own.
 */
export const NOTICE_DAYS = 14;
export const NOTICE_EPOCHS = 3;
export const URGENT_DAYS = 3;
export const URGENT_EPOCHS = 1;
/**
 * How far ahead a warning stage reaches, in epochs: a floor in days and a floor in epochs, wider
 * one wins.
 *
 * The day count rounds UP, because arriving a tick late is the quiet failure the whole surface
 * exists to prevent.
 */
export function warningEpochs(clock, days, floorEpochs) {
    return Math.max(Math.ceil((days * DAY_MS) / clock.durationMs), floorEpochs);
}
/**
 * Whole days from `nowMs` until `epoch` is reached, by the network's own clock.
 *
 * With an anchor both ends collapse onto one moment. Without one, the honest answer is the
 * earliest the epoch can arrive — see the header for why the other edge is never used.
 */
export function daysLeftUntilEpoch(clock, epoch, nowMs) {
    const ahead = epoch - clock.current;
    if (clock.startedMs !== null) {
        return { days: Math.floor((clock.startedMs + ahead * clock.durationMs - nowMs) / DAY_MS), exact: true };
    }
    return { days: Math.floor(((ahead - 1) * clock.durationMs) / DAY_MS), exact: false };
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
