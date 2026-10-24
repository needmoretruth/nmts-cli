// Going on across a connection that dropped, changed, or is simply slow.
//
// ⛔ THE POLICY IS NOT WRITTEN HERE. It is `shared/lib/net/retry-budget.ts`, copied byte for byte
//    from the browser, so that both programs mean the same thing by "we tried". What IS here is
//    the waiting, because how you wait is different in a terminal than in a page.
//
// ⛔ WHAT MAY BE REPEATED, AND WHAT MAY NEVER BE. Repeating a GET costs nothing. Repeating a write
//    whose outcome is unknown can spend money twice -- a request that reached the server and died
//    on the way back looks exactly like one that never arrived. So a write is repeated ONLY when
//    it carries an idempotency key, which is the server's promise that a second copy of the same
//    request is the same request. Everything else fails once and says so.
//
// ⛔ NOTHING IS RETRIED SILENTLY. A person running this in a terminal and an agent reading its
//    output both need to know that the tool is waiting rather than stuck; `onWait` is how they are
//    told, and every command that can wait passes something.
//
// ⚠ NODE HAS NO "ONLINE" EVENT AND NO ONLINE FLAG. A browser can be told the network came back;
//   here the only way to find out is to ask again. So the offline branch of the policy is not
//   reachable from this file, and the whole budget is the online one -- which is honest: without a
//   signal to wait for, waiting longer is just waiting.
import { nextAttempt, WATCHED_RETRY_BUDGET_MS } from "./shared/lib/net/retry-budget.ts";

/**
 * How long a command goes on trying before it reports the failure.
 *
 * ⛔ SHORTER THAN ANYTHING ELSE, BECAUSE SOMEBODY TYPED THIS AND IS LOOKING AT IT. The long budget
 *    is for work nobody is watching -- a page uploading in the background, which has money already
 *    spent on it and resumes where it stopped. A terminal that sits silent is indistinguishable
 *    from one that has hung, an agent has a deadline of its own, and running the command again
 *    costs nothing. What this has to cover is a link that blinks, not a server that is down.
 */
export const CLI_RETRY_BUDGET_MS = Math.round(WATCHED_RETRY_BUDGET_MS / 3);

/** Told before each wait, so a terminal can say the tool is waiting rather than stuck. */
export type WaitReporter = (info: { attempt: number; waitMs: number; error: unknown }) => void;

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
export async function keepTrying<T>(step: () => Promise<T>, options: KeepTryingOptions): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let elapsedOnlineMs = 0;
  for (let attempt = 1; ; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      return await step();
    } catch (error) {
      if (options.signal?.aborted === true) throw error;
      if (!options.retryable(error)) throw error;
      const plan = nextAttempt({
        attempt,
        elapsedOnlineMs,
        elapsedOfflineMs: 0,
        online: true,
        random: random(),
        budgetMs: options.budgetMs ?? CLI_RETRY_BUDGET_MS,
      });
      if (!plan.again) throw error;
      options.onWait?.({ attempt, waitMs: plan.waitMs, error });
      const before = now();
      await sleep(plan.waitMs);
      // The time that actually passed, not the time that was planned: a machine that was suspended
      // mid-wait spent all of it, and charging the planned number would let it wait for ever.
      elapsedOnlineMs += Math.max(0, now() - before);
    }
  }
}

/**
 * Is this failure one that asking again could fix?
 *
 * ⛔ A REFUSAL IS NOT A BLIP. The server saying no -- wrong key, no credits, not found -- is an
 *    answer, and repeating it spends the budget to hear it again later. Only the shapes that mean
 *    "nobody answered" or "not right now" come back here as true.
 */
export function isTransient(error: unknown, status?: number): boolean {
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  if (!(error instanceof Error)) return false;
  // ⭐ 2026-10-21 — THE CHAIN IS gRPC NOW, and a gRPC error names what happened as a status word
  //    (`RpcError.code`). Only two of them mean "nobody answered": UNAVAILABLE and RESOURCE_EXHAUSTED
  //    (what a 503 and a 429 become). Every other status — NOT_FOUND, INVALID_ARGUMENT, a refused
  //    transaction — is the node ANSWERING. The failover `fetch` throws a last host's 5xx as
  //    "<host> → HTTP <n>", and the transport keeps that sentence as the message, so the number is
  //    read back out of it.
  if (error.name === "RpcError") {
    const code: unknown = Reflect.get(error, "code");
    if (code === "UNAVAILABLE" || code === "RESOURCE_EXHAUSTED") return true;
  }
  const http = /→ HTTP (\d{3})\b/.exec(error.message);
  if (http?.[1] !== undefined) return isTransient(null, Number(http[1]));
  // ⛔ A DEADLINE THAT FIRED IS NOT A BLIP. The request already had its thirty seconds; asking
  //    again usually spends thirty more and ends the same way, and the deadline exists precisely so
  //    that an agent loop is not left waiting. What comes back here as true is a connection that
  //    was refused, reset or never made -- which is what moving between networks looks like.
  return /could not reach|fetch failed|network|ECONNRESET|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(
    `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`,
  );
}
