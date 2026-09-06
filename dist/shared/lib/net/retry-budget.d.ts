/** First wait after a failure, before jitter. */
export declare const RETRY_BASE_MS = 1000;
/**
 * The longest single wait. Without a ceiling the ninth backoff is eight minutes, and a person
 * watching a progress bar cannot tell that from a program that has stopped.
 */
export declare const RETRY_MAX_WAIT_MS = 30000;
/**
 * How long to go on retrying while the network is reachable and the far side keeps failing.
 *
 * ⚠ THIS IS THE UPLOAD-SHAPED DEFAULT: money is already spent, the work resumes where it stopped,
 *   and nobody is staring at it. A surface where none of that is true passes its own (`budgetMs`).
 */
export declare const RETRY_BUDGET_MS: number;
/**
 * The budget for something a person is watching and can simply ask for again — a download.
 *
 * ⚠ It is not small because failing is fine; it is small because ten minutes of "still trying" is
 *   indistinguishable from a program that has stopped, and pressing again costs nothing here.
 */
export declare const WATCHED_RETRY_BUDGET_MS = 60000;
/** The matching offline bound for a watched surface. */
export declare const WATCHED_OFFLINE_BUDGET_MS: number;
/** How long to go on waiting while there is no network at all. Longer, because waiting is free. */
export declare const OFFLINE_BUDGET_MS: number;
/** How often to look again while offline. The `online` event is the real signal; this is the net. */
export declare const OFFLINE_POLL_MS = 2000;
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
export declare function nextAttempt(input: AttemptInput): NextAttempt;
/**
 * How much of the budget is left, as a fraction — for a screen that wants to say how long it will
 * go on trying. Null when nothing has been spent on this kind of waiting yet.
 */
export declare function budgetLeft(elapsedMs: number, waitingForNetwork: boolean): number;
