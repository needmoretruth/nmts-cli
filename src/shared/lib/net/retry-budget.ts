// Waiting for a network to come back and repeating a failure are different things, and this is the
// arithmetic that tells them apart. Numbers in, a decision out.
//
// ⛔ AND IT IS ENGLISH, unlike most notes in this tree: these exact bytes are copied into the
//    published command-line package, so that both programs answer "have we tried hard enough" the
//    same way. Two policies is two answers, and the one nobody looks at is the one that gives up
//    early.
//
// ⛔ WHY IT EXISTS. What this product did about a dropped connection was three attempts, two and
//    four seconds apart, on one step of one upload path; a download had two attempts a quarter of
//    a second apart. Moving between a phone's data and a wifi network takes five to thirty
//    seconds. So the retries were spent before the network came back, every time, and a person was
//    handed a choice they had no way to make: resume, or give up.
//
// ⛔ TIME IS THE BUDGET, NOT A COUNT OF ATTEMPTS. "We tried three times" says nothing; three
//    attempts six seconds apart is not trying. What a person means by "keep trying" is a length of
//    time, so that is what is counted.
//
// ⛔ BEING OFFLINE DOES NOT SPEND THE BUDGET. There is nothing to retry while there is no network,
//    and charging that time to the budget is how a long tunnel becomes a failed upload. Waiting
//    for the network has its own, longer, bound — it exists so a forgotten process does not hold a
//    file open forever, not to give up on somebody who is briefly out of range.
//
// ⚠ WHATEVER SAYS "ONLINE" IS A HINT AND NOTHING MORE. A browser's flag is false when there is
//   certainly no network and true when there might be one, so it is read for the FALSE case only:
//   the caller keeps asking the network itself, and this decides how long to wait between askings.
//
// PURE: no DOM, no clock of its own, no randomness of its own — every input is passed in. That is
// what lets a test drive a tunnel, a flapping link and an exhausted budget on demand.

/** First wait after a failure, before jitter. */
export const RETRY_BASE_MS = 1_000;

/**
 * The longest single wait. Without a ceiling the ninth backoff is eight minutes, and a person
 * watching a progress bar cannot tell that from a program that has stopped.
 */
export const RETRY_MAX_WAIT_MS = 30_000;

/**
 * How long to go on retrying while the network is reachable and the far side keeps failing.
 *
 * ⚠ THIS IS THE UPLOAD-SHAPED DEFAULT: money is already spent, the work resumes where it stopped,
 *   and nobody is staring at it. A surface where none of that is true passes its own (`budgetMs`).
 */
export const RETRY_BUDGET_MS = 10 * 60_000;

/**
 * The budget for something a person is watching and can simply ask for again — a download.
 *
 * ⚠ It is not small because failing is fine; it is small because ten minutes of "still trying" is
 *   indistinguishable from a program that has stopped, and pressing again costs nothing here.
 */
export const WATCHED_RETRY_BUDGET_MS = 60_000;

/** The matching offline bound for a watched surface. */
export const WATCHED_OFFLINE_BUDGET_MS = 5 * 60_000;

/** How long to go on waiting while there is no network at all. Longer, because waiting is free. */
export const OFFLINE_BUDGET_MS = 30 * 60_000;

/** How often to look again while offline. The `online` event is the real signal; this is the net. */
export const OFFLINE_POLL_MS = 2_000;

/** What the caller should do next. */
export interface NextAttempt {
  /** False ⇒ the budget is spent. Report the failure honestly and stop. */
  readonly again: boolean;
  /** How long to wait first, in ms. */
  readonly waitMs: number;
  /**
   * True ⇒ this wait is for the network to come back, not for a busy server.
   *
   * ⛔ The caller must NOT add this wait to `elapsedOnlineMs`, and the screen must say
   *    「waiting for the network」 rather than 「retrying」 — those are different facts, and only
   *    one of them is something the person can do anything about.
   */
  readonly waitingForNetwork: boolean;
}

export interface AttemptInput {
  /** 1-based number of the attempt that just failed. */
  readonly attempt: number;
  /** Wall clock spent retrying WHILE ONLINE, in ms. Offline waiting is not counted here. */
  readonly elapsedOnlineMs: number;
  /** Wall clock spent waiting for a network, in ms. */
  readonly elapsedOfflineMs: number;
  /** What the browser says about having a network. Believed only when it says no. */
  readonly online: boolean;
  /** A number in [0, 1). Passed in so the jitter is reproducible in a test. */
  readonly random: number;
  /**
   * How long to go on retrying while online. Defaults to {@link RETRY_BUDGET_MS}.
   *
   * ⛔ IT IS NOT ONE NUMBER FOR EVERYTHING, because the two sides are not the same bargain. An
   *    upload has money already spent on it and resumes where it stopped, so waiting is cheap and
   *    giving up is expensive. A download has nothing at stake and the person is watching it — ten
   *    minutes of "still trying" there is a program that looks broken, and pressing it again costs
   *    nothing. So the caller says.
   */
  readonly budgetMs?: number;
  /** How long to go on waiting for a network. Defaults to {@link OFFLINE_BUDGET_MS}. */
  readonly offlineBudgetMs?: number;
}

/**
 * What to do after one failed attempt.
 *
 * ⛔ THE ORDER OF THE TWO CHECKS MATTERS. Offline is decided first, because a failure that
 *    happened because there is no network must not spend the online budget — otherwise a tunnel
 *    long enough to exhaust it turns into a failed upload the moment the network returns.
 */
export function nextAttempt(input: AttemptInput): NextAttempt {
  if (!input.online) {
    return {
      again: input.elapsedOfflineMs < (input.offlineBudgetMs ?? OFFLINE_BUDGET_MS),
      waitMs: OFFLINE_POLL_MS,
      waitingForNetwork: true,
    };
  }
  const step = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, input.attempt - 1), RETRY_MAX_WAIT_MS);
  // Jitter spreads parts that failed together: without it every part of one file wakes at the same
  // instant and hits the same host again, which is the load that made them fail.
  const jitter = Math.floor(clampRandom(input.random) * RETRY_BASE_MS);
  return {
    again: input.elapsedOnlineMs < (input.budgetMs ?? RETRY_BUDGET_MS),
    waitMs: step + jitter,
    waitingForNetwork: false,
  };
}

/** A caller that hands over something that is not a number must not silently get a fixed wait. */
function clampRandom(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value >= 1 ? 0.999_999 : value;
}

/**
 * How much of the budget is left, as a fraction — for a screen that wants to say how long it will
 * go on trying. Null when nothing has been spent on this kind of waiting yet.
 */
export function budgetLeft(elapsedMs: number, waitingForNetwork: boolean): number {
  const total = waitingForNetwork ? OFFLINE_BUDGET_MS : RETRY_BUDGET_MS;
  return Math.max(0, 1 - elapsedMs / total);
}
