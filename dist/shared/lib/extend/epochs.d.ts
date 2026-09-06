/** One blob's lease, as the chain currently has it. */
export interface BlobLease {
    /** Sui object id of the blob. */
    objectId: string;
    /** Unencoded size in bytes (Blob.size) — what the storage price is computed from. */
    size: number;
    /** The epoch the lease runs out at (Blob.storage.end_epoch). THE authoritative expiry. */
    endEpoch: number;
}
/** Where the network is now, how far ahead anyone may buy, and how long an epoch lasts. */
export interface EpochWindow {
    /** The epoch the network is in. */
    current: number;
    /**
     * How many epochs ahead of `current` a lease may reach — the protocol's
     * `storage_accounting::max_epochs_ahead`, read as the future-accounting ring length (that is
     * exactly what the Move function returns). Measured 53 on testnet, 2026-07-27.
     */
    maxAhead: number;
    /** One epoch's length in milliseconds (testnet 1 day · mainnet 14 days — read, not assumed). */
    durationMs: number;
    /**
     * When the current epoch began, in ms. Null while the network is mid-epoch-change, in which case
     * no date is shown at all — a wrong date on a screen about deletion is worse than no date.
     */
    startedMs: number | null;
}
/**
 * The wall-clock moment an epoch is reached, from the network's own epoch clock. Null when there
 * is no anchor to measure from.
 *
 * ⚠ An ESTIMATE, and labelled as one wherever it is shown: epoch changes can run late, and the
 * measured history proves it (epoch 471 began 9 days later than `first_epoch_start` plus 470 × the
 * epoch length would put it). Never present this as the exact deletion time.
 */
export declare function epochDate(window: LeaseClock, epoch: number): Date | null;
/**
 * The window an epoch can arrive in — an answer even when the clock is only APPROXIMATE.
 *
 * ⚠ The two ends are clamped at "now" only on the approximate branch, where a negative bound is an
 * artefact of not knowing how far into the current epoch we are. An anchored date that lands in the
 * past is a real answer (the lease ended on that day) and is returned as it is.
 */
export declare function epochDateBounds(clock: LeaseClock, epoch: number, nowMs: number): {
    earliest: Date;
    latest: Date;
    exact: boolean;
} | null;
/**
 * Warn from here on. Two stages: a plain note, then a red one.
 *
 * ⭐ THEY LIVE HERE, NOT IN THE COMPONENT THAT DRAWS THE BANNER (moved 2026-07-30). Two surfaces
 * now read them — the drive-wide banner (`ExpiryNotice`) and every file row's own status
 * (`lib/drive/file-status.ts`). A copy in each is how a banner ends up shouting "extend now" over
 * a list of rows that all say "sealed", with neither file looking wrong on its own.
 * ⚠ A `.tsx` cannot hold them either: `node --test` reads plain `.ts` and not `.tsx`, so a constant
 * parked in a component is a constant no pure test can check.
 *
 * Both stages are a floor in DAYS and a floor in EPOCHS, and the wider one wins (see
 * `warningEpochs`). The epoch figures are what mainnet is really sized by: 3 epochs is six weeks of
 * runway there, and 1 epoch — the urgent stage — is the last two weeks in which extending is still
 * possible at all.
 */
export declare const NOTICE_DAYS = 14;
export declare const NOTICE_EPOCHS = 3;
export declare const URGENT_DAYS = 3;
export declare const URGENT_EPOCHS = 1;
/**
 * How far ahead the expiry warning starts, in epochs: a floor in DAYS and a floor in EPOCHS, wider
 * one wins.
 *
 * Counted in days alone, mainnet's 14-day epoch made the whole warning exactly ONE epoch wide, so
 * someone who opens the app monthly missed it entirely. Counted in epochs alone, testnet's 1-day
 * epoch would have shrunk the window from 14 days to 3. Taking whichever is longer never narrows
 * either network's warning — and the day-count rounds UP, because arriving a tick late is the
 * quiet failure this whole surface exists to prevent.
 */
export declare function warningEpochs(days: number, floorEpochs: number, durationMs: number): number;
/** The part of the epoch clock that turns an end epoch into a number of days. */
export interface LeaseClock {
    /** The epoch the network is in. */
    current: number;
    /** One epoch's length in ms — 1 day on testnet, 14 on mainnet. Read, never assumed. */
    durationMs: number;
    /**
     * When the current epoch began, when the network said so (`EpochChangeDone`). Absent or null ⇒
     * there is no anchor, and every figure derived from this clock is a FLOOR rather than a
     * measurement. Optional so a caller with only the two numbers above still type-checks; the real
     * clock (`EpochWindow`) always carries it.
     */
    startedMs?: number | null;
}
/** Whole days until a lease ends, and whether that number is a measurement or a floor. */
export interface DaysLeft {
    /** Rounded DOWN. Negative is a real answer — the epoch is already behind us. */
    days: number;
    /** False ⇒ `days` is a LOWER BOUND and the words beside it must say "or more". */
    exact: boolean;
}
/**
 * Whole days from now until `epoch` is reached, by the network's own epoch clock.
 *
 * ⛔ THE SAFE EDGE, NOT THE OPTIMISTIC ONE (fixed 2026-08-16). This used to be
 * `(epoch − current) × epochLength`, which ignores the time already spent inside the current epoch
 * — on mainnet that overstates the runway by up to fourteen days, and it did: 28 shown where the
 * chain said 23. Without an anchor the answer is now the floor of `epochArrival`'s `minMs`, and
 * `exact: false` tells the surface to say "N days or more" instead of making a flat claim.
 *
 * ⛔ Never substitute `NETWORK.epochDays` for the clock here. That constant is the MAINNET basis
 * (14); using it on testnet, where an epoch is one day, would report 196 days over a file with
 * fourteen days to live.
 *
 * Null when the clock carries no usable epoch length — the caller says the period is unread rather
 * than counting days from a constant.
 */
export declare function daysLeftUntilEpoch(epoch: number, clock: LeaseClock, nowMs: number): DaysLeft | null;
/** How much time is left, broken into the units a person reads off a clock. */
export interface TimeLeft {
    /** Whole days. */
    days: number;
    /** 0–23. */
    hours: number;
    /** 0–59. */
    minutes: number;
    /** 0–59. */
    seconds: number;
    /** Total milliseconds, floored at zero. */
    totalMs: number;
    /** False ⇒ this is a LOWER BOUND — the real moment is later, by up to one epoch. */
    exact: boolean;
}
/**
 * The same answer `daysLeftUntilEpoch` gives, down to the second.
 *
 * ⭐ WHY THIS EXISTS: a day count is the right thing to glance at and the wrong thing to plan by
 * on the last day. "1 day left" covers everything from twenty-four hours to one minute, and by
 * then the only question left is whether there is time to deal with it tonight.
 *
 * ⛔ IT IS THE SAME EDGE AS THE DAY COUNT, on purpose. Both take `epochArrival`'s `minMs`, so the
 *    two can never disagree: a countdown reading three hours under a label reading "2 days left"
 *    would be two numbers about one fact, and a person believes the reassuring one.
 *
 * ⚠ EVEN EXACT IS AN ESTIMATE, and the direction is known: an epoch change can run LATE, never
 *   early, so this can only be early. Measured on mainnet 2026-08-25 — 36 epochs after the first,
 *   the accumulated drift was nine minutes.
 *
 * Null on the same input as `daysLeftUntilEpoch`: no usable epoch length.
 */
export declare function timeLeftUntilEpoch(epoch: number, clock: LeaseClock, nowMs: number): TimeLeft | null;
/**
 * The largest number of epochs these leases can ALL be extended by.
 *
 * The ceiling is per-blob: a lease may not end more than `maxAhead` epochs past the current one,
 * so the blob that already reaches furthest into the future is the binding one. Returns 0 when
 * nothing more can be bought yet — which is a real answer ("already paid as far ahead as the
 * network allows"), not an error.
 */
export declare function headroom(leases: readonly BlobLease[], window: EpochWindow): number;
/**
 * The enum cases of the network's `epoch_state` that carry WHEN THE CURRENT EPOCH BEGAN.
 *
 * ⛔ THERE ARE TWO OF THEM, AND READING ONLY THE FIRST COST US A FORTNIGHT OF PRECISION. The Move
 *    enum has three cases: `EpochChangeSync` (a node count — a small integer, NOT a moment),
 *    `EpochChangeDone` (the moment this epoch's change happened), and `NextParamsSelected` (the
 *    same moment, kept after the next epoch's parameters are chosen). A network settles into the
 *    LAST of those and stays there, so an implementation that accepted `EpochChangeDone` alone
 *    threw the anchor away nearly always. Measured on mainnet 2026-08-25: epoch 37 reported
 *    `NextParamsSelected` holding 2026-08-11T15:08:58Z — exactly one epoch before its end. Without
 *    it `epochArrival` falls back to a range ONE WHOLE EPOCH wide (fourteen days on mainnet), and
 *    every surface that counts down to a deletion then says "as early as N days" — honest, and
 *    useless to somebody deciding whether to pay for more time.
 *
 * ⛔ THIS IS AN ALLOW-LIST, NOT A DENY-LIST. `EpochChangeSync` carries a `u16`, which is finite and
 *    would happily become a date in 1970; and a case this code has not been taught must report NO
 *    anchor rather than guess. Losing precision costs a warning that comes early. Guessing costs a
 *    deleted file.
 */
export declare const EPOCH_START_VARIANTS: readonly string[];
/**
 * When the current epoch began, in ms — or null when this reading cannot say.
 *
 * ⭐ ONE OF IT, ON PURPOSE. Both the browser and the command-line tool read the same enum for the
 * same reason, and a second narrowing elsewhere would be a second answer to "has this epoch
 * settled" — the two would drift the day the protocol renames a case, and drift here is a wrong
 * deletion date on a screen where somebody spends money.
 *
 * Read by name rather than cast: a shape change in the protocol has to surface as "no anchor",
 * which costs precision, instead of as a NaN that becomes a date.
 */
export declare function epochStartedMs(epochState: unknown): number | null;
/**
 * When a file actually runs out: the SOONEST end epoch across the blobs it rides on. Null when
 * there is no lease to read.
 *
 * ⚠ NULL IS NOT A ZERO AND NOT "NOW" (2026-07-28). The sheet that shows this used to
 * substitute the CURRENT epoch when the list was empty, and so printed today's date under "expires
 * on" above the sentence "after this date the file is deleted and cannot be recovered" —
 * telling someone their file dies today. The empty case is reached by real files: every part on
 * treasury-paid storage, or parts old enough to carry no on-chain object id, produce no targets
 * and therefore no leases. There is no epoch to report for those, so this reports none and the
 * caller shows nothing rather than a number it invented.
 *
 * SOONEST, not furthest: one expired blob is enough to make the file unreadable.
 */
export declare function soonestEnd(leases: readonly BlobLease[]): number | null;
