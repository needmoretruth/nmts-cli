// The half of storage-lease reasoning that never speaks to a network: when a lease runs out, when
// to start warning, and how much more time can still be bought. Numbers in, numbers out.
//
// ⛔ WHY IT IS NOT IN `chain.ts` ANY MORE. The command-line tool has to answer the same questions,
//    and that file also imports the wallet client, which a command-line package cannot follow. So
//    the tool had a SECOND IMPLEMENTATION of this arithmetic, and the only thing a machine compared
//    between them was four threshold numbers. ⚠ COMPARING VALUES DOES NOT STOP TWO PROGRAMS
//    COMPUTING DIFFERENT ANSWERS FROM THEM — and the answer here is printed on a screen where
//    somebody decides whether to spend money. This file is now copied byte for byte into that
//    package, so both programs run the same functions.
//
// ⛔ DO NOT ADD AN IMPORT HERE. The moment this file imports anything the copy cannot resolve, the
//    copy breaks and the tool goes back to writing its own. Everything that talks to the chain
//    belongs in `chain.ts`, which re-exports these names so callers need not know the split exists.
//
// ⛔ AND IT IS ENGLISH, unlike most notes in this tree: these exact bytes are published in a
//    separate public repository, whose checks refuse Korean and refuse pointers into documents
//    nobody outside can read.
//
// PURE: not even a clock — `nowMs` is always passed in. That is what lets a plain test drive the
// branches a real network only reaches while it is changing epochs.

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
export function epochDate(window: LeaseClock, epoch: number): Date | null {
  // ⚠ `== null` catches undefined as well as null. `LeaseClock.startedMs` is optional, so a
  //    `=== null` test lets undefined through and the arithmetic produces an Invalid Date.
  if (window.startedMs == null || !Number.isFinite(window.durationMs)) return null;
  return new Date(window.startedMs + (epoch - window.current) * window.durationMs);
}

/**
 * ⭐ THE ONE PIECE OF ARITHMETIC EVERY EXPIRY SURFACE STANDS ON: how long until `epoch` arrives,
 * in ms from `nowMs`, as a RANGE.
 *
 * `epochDate` refuses to answer without an exact anchor (`startedMs`), and the network lives in
 * that state most of the time — so the extend sheet said "cannot be determined" over a file whose
 * end epoch and epoch length were both known. Not knowing exactly is not the same as knowing
 * nothing, and drawing one as the other loses a real answer. What IS known pins the moment to one
 * epoch's width: we are somewhere
 * inside epoch `current` and cannot tell how far in, so `epoch` arrives between (epoch−current−1)
 * and (epoch−current) epoch-lengths from now.
 *
 * ⛔ `max` — (epoch−current) whole epochs — IS THE DEFECT. It is the OPTIMISTIC edge:
 * it silently assumes the current epoch has not started yet. On mainnet, where an epoch is
 * fourteen days, a file was told it had 28 days left when the chain said 23 (measured 2026-08-02,
 * 2026-08-02). Anything shown to a person about deletion takes `min` — it can only warn early,
 * never late — and the words beside it then say "or more" / "as early as", because a floor is not
 * a measurement.
 *
 * With an exact anchor both ends collapse onto one moment (`exact: true`). Null only when the
 * epoch length itself is missing — a window `readEpochWindow` never produces.
 */
function epochArrival(
  clock: LeaseClock,
  epoch: number,
  nowMs: number,
): { minMs: number; maxMs: number; exact: boolean } | null {
  if (!Number.isFinite(clock.durationMs) || clock.durationMs <= 0) return null;
  const ahead = epoch - clock.current;
  const started = clock.startedMs;
  if (started != null && Number.isFinite(started)) {
    const at = started + ahead * clock.durationMs - nowMs;
    return { minMs: at, maxMs: at, exact: true };
  }
  return {
    minMs: (ahead - 1) * clock.durationMs,
    maxMs: ahead * clock.durationMs,
    exact: false,
  };
}

/**
 * The window an epoch can arrive in — an answer even when the clock is only APPROXIMATE.
 *
 * ⚠ The two ends are clamped at "now" only on the approximate branch, where a negative bound is an
 * artefact of not knowing how far into the current epoch we are. An anchored date that lands in the
 * past is a real answer (the lease ended on that day) and is returned as it is.
 */
export function epochDateBounds(
  clock: LeaseClock,
  epoch: number,
  nowMs: number,
): { earliest: Date; latest: Date; exact: boolean } | null {
  const a = epochArrival(clock, epoch, nowMs);
  if (a === null) return null;
  if (a.exact) {
    const at = new Date(nowMs + a.minMs);
    return { earliest: at, latest: at, exact: true };
  }
  return {
    earliest: new Date(nowMs + Math.max(0, a.minMs)),
    latest: new Date(nowMs + Math.max(0, a.maxMs)),
    exact: false,
  };
}

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
export const NOTICE_DAYS = 14;
export const NOTICE_EPOCHS = 3;
export const URGENT_DAYS = 3;
export const URGENT_EPOCHS = 1;

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
export function warningEpochs(days: number, floorEpochs: number, durationMs: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(Math.ceil((days * dayMs) / durationMs), floorEpochs);
}

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
export function daysLeftUntilEpoch(epoch: number, clock: LeaseClock, nowMs: number): DaysLeft | null {
  const a = epochArrival(clock, epoch, nowMs);
  if (a === null) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return { days: Math.floor(a.minMs / dayMs), exact: a.exact };
}

/**
 * The largest number of epochs these leases can ALL be extended by.
 *
 * The ceiling is per-blob: a lease may not end more than `maxAhead` epochs past the current one,
 * so the blob that already reaches furthest into the future is the binding one. Returns 0 when
 * nothing more can be bought yet — which is a real answer ("already paid as far ahead as the
 * network allows"), not an error.
 */
export function headroom(leases: readonly BlobLease[], window: EpochWindow): number {
  if (leases.length === 0) return 0;
  const furthest = Math.max(...leases.map((l) => l.endEpoch));
  return Math.max(0, window.current + window.maxAhead - furthest);
}

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
export function soonestEnd(leases: readonly BlobLease[]): number | null {
  if (leases.length === 0) return null;
  return Math.min(...leases.map((l) => l.endEpoch));
}
