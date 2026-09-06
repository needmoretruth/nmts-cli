/**
 * How long a command goes on trying before it reports the failure.
 *
 * ⛔ SHORTER THAN ANYTHING ELSE, BECAUSE SOMEBODY TYPED THIS AND IS LOOKING AT IT. The long budget
 *    is for work nobody is watching -- a page uploading in the background, which has money already
 *    spent on it and resumes where it stopped. A terminal that sits silent is indistinguishable
 *    from one that has hung, an agent has a deadline of its own, and running the command again
 *    costs nothing. What this has to cover is a link that blinks, not a server that is down.
 */
export declare const CLI_RETRY_BUDGET_MS: number;
/** Told before each wait, so a terminal can say the tool is waiting rather than stuck. */
export type WaitReporter = (info: {
    attempt: number;
    waitMs: number;
    error: unknown;
}) => void;
export interface KeepTryingOptions {
    /** Whether this failure is worth repeating. ⛔ Required: see the header. */
    readonly retryable: (error: unknown) => boolean;
    readonly onWait?: WaitReporter;
    readonly signal?: AbortSignal;
    /** How long to keep trying, in ms. Omit for {@link CLI_RETRY_BUDGET_MS}. */
    readonly budgetMs?: number;
    /** Injected so a test runs a flapping link in milliseconds rather than in minutes. */
    readonly now?: () => number;
    readonly random?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
}
/** Run `step` until it succeeds or the budget is spent. Rejects with the LAST error. */
export declare function keepTrying<T>(step: () => Promise<T>, options: KeepTryingOptions): Promise<T>;
/**
 * Is this failure one that asking again could fix?
 *
 * ⛔ A REFUSAL IS NOT A BLIP. The server saying no -- wrong key, no credits, not found -- is an
 *    answer, and repeating it spends the budget to hear it again later. Only the shapes that mean
 *    "nobody answered" or "not right now" come back here as true.
 */
export declare function isTransient(error: unknown, status?: number): boolean;
