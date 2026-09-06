// Talking to the NMTS server.
//
// ⛔ THIS DOES NOT RETRY THE HUMAN CHECK. The browser's client answers a CLEARANCE_REQUIRED by
//    fetching a fresh captcha token and trying once more. In Node there is no captcha to fetch, so
//    that path posts an empty token, fails again, and the whole thing surfaces as "the API rejects
//    everything" with no mention of the real cause. Here a clearance refusal is returned as itself,
//    named, with the reason a command-line tool cannot satisfy it.
//
// ⛔ EVERY REQUEST HAS A DEADLINE. An agent runs this in a loop with no person watching; a request
//    that hangs forever is worse than one that fails, because nothing ever reports it.
//
// ⛔ THE TOKEN IS NEVER IN A MESSAGE, A URL OR A LOG. It goes in one header and nowhere else.

import { adviseFor } from "./api-advice.ts";
import { NmtsError } from "./errors.ts";
import { isTransient, keepTrying, type WaitReporter } from "./net-retry.ts";
import { noteRequest } from "./run-log.ts";

/** Default deadline for a request that is not moving file bytes. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type { ServerRefusal } from "./api-refusal.ts";
import type { ServerRefusal } from "./api-refusal.ts";
import { isRefusal } from "./api-refusal.ts";

/** A refusal the server explained. Carries its code so a caller can branch without string matching. */
export class ServerError extends NmtsError {
  readonly status: number;
  readonly code: string;
  /** Seconds to wait. ⛔ `Retry-After` is the only place the server sends it — never the body. */
  readonly retryAfter: number | null;
  /**
   * Whatever the refusal carried beside its words — the two credit amounts a doubled release fee
   * is refused with, a limit that was hit, an address to go to.
   *
   * ⚠ NOT VALIDATED HERE. It arrives from the network and every reader checks the one field it
   *   wants before printing it; a narrower type would be a claim rather than a check.
   */
  readonly details: Readonly<Record<string, string | number>>;

  constructor(status: number, refusal: ServerRefusal, nextStep: string | null, retryAfter: number | null = null) {
    super(refusal.message, { exitCode: 1, nextStep });
    this.name = "ServerError";
    this.status = status;
    this.code = refusal.code;
    this.retryAfter = retryAfter;
    this.details = refusal.details ?? {};
  }
}

/**
 * A failure the server did NOT explain: a status with no refusal body behind it.
 *
 * ⛔ IT CARRIES THE STATUS SO A CALLER NEED NOT MATCH ON THE MESSAGE. The routes that serve
 *    documents answer 404 with an empty body for an id nothing has — there is no code to branch
 *    on, and "read the message and look for 404 in it" is how a refusal ends up being decided by
 *    a sentence somebody later rewrote. It extends `NmtsError` and changes nothing about how this
 *    failure is retried, reported or exited: only that a caller can now ask what the status was.
 */
export class HttpError extends NmtsError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message, { exitCode: 1 });
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * A body the server sent as text, and the name its `Content-Disposition` gives that text.
 *
 * ⛔ THE NAME IS THE SERVER'S, NOT THIS TOOL'S. A notice kept from a terminal and the same notice
 *    kept from the browser's download button should be the same bytes under the same name, and
 *    the only way to be sure of that is to take the name from the one place both clients read it.
 *    ⚠ It is still a name that arrived over the network: whatever writes a file with it puts it
 *      through `safe-path.ts` first.
 */
export interface TextAnswer {
  readonly text: string;
  /** Null when the answer named no file. */
  readonly filename: string | null;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Session bearer token. Sent in the Authorization header and nowhere else. */
  token?: string | undefined;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  /**
   * Told before each wait between attempts, so a terminal can say the tool is waiting.
   *
   * ⛔ NOTHING IS RETRIED SILENTLY. A person watching and an agent reading the output both need to
   *    know the difference between a tool that is waiting and one that is stuck.
   */
  onWait?: WaitReporter;
  /**
   * How long to keep trying a request that is safe to repeat. Omit for the default.
   *
   * ⛔ 0 MEANS ONE ATTEMPT. That is what a caller measuring the shape of a single failure wants,
   *    and it is the only way to ask for it — there is no separate "no retry" flag to fall out of
   *    step with this one.
   */
  retryBudgetMs?: number;
  /**
   * Make this request safe to repeat.
   *
   * ⛔ A NARROW OPTION RATHER THAN ARBITRARY HEADERS. The two calls that need it are the two that
   *    SPEND -- committing a file and reserving storage -- and a general header bag on a client
   *    that carries a bearer token is a way to send that token somewhere it was not meant to go.
   */
  idempotencyKey?: string;
  /**
   * Proof that this run holds the account code, for the three routes that ask for one.
   *
   * ⛔ A NAMED OPTION, FOR THE SAME REASON `idempotencyKey` IS ONE. A general header bag on a
   *    client that carries a bearer token is a way to send that token somewhere it was not meant
   *    to go; this is one field, filled by one module, and it reaches exactly one header.
   *
   * ⛔ ITS VALUE IS NEVER IN A MESSAGE, A URL OR A LOG. `account-proof.ts` says what it is and
   *    what it can still do if it leaks. The server refuses to log it either — see
   *    `ACCOUNT_PROOF_HEADER` in `api/src/auth/api_key_auth.rs`.
   */
  accountProof?: string;
  /**
   * What the answer is. Absent means JSON, which is what every `/v1` route sends.
   *
   * ⛔ ONE OPTION RATHER THAN A SECOND CLIENT. The site serves three documents as text — the
   *    notice board's rows, one notice, one legal document — and a separate fetch for them would
   *    be a second place holding the deadline, the retry rule, the run log and the refusal
   *    reading. Two of those going out of step is not hypothetical here: `check:cli-routes` exists
   *    because a command once called an address the server did not have, and it can only see
   *    calls that come through this function.
   */
  as?: "text";
}


/**
 * One request to the NMTS server, returning parsed JSON or throwing a named refusal.
 *
 * `path` starts with `/v1/` for the API, or `/api/` for the three documents the site itself
 * serves. It is joined to the base without any normalising, so a caller cannot accidentally send
 * a request to a different host by passing an absolute URL.
 */
export async function request(
  base: string,
  path: string,
  options: RequestOptions & { as: "text" },
): Promise<TextAnswer>;
export async function request(base: string, path: string, options?: RequestOptions): Promise<unknown>;
export async function request(base: string, path: string, options: RequestOptions = {}): Promise<unknown> {
  if (!path.startsWith("/")) throw new NmtsError(`A request path must start with "/": ${path}`);
  // ⛔ REPEATED ONLY WHERE REPEATING IS THE SAME REQUEST. A read always is. A write is only when it
  //    carries an idempotency key, because a request that reached the server and died on the way
  //    back looks exactly like one that never arrived -- and guessing wrong there spends money
  //    twice. Everything else fails once and says so, exactly as it did before.
  const safeToRepeat =
    options.method === undefined ||
    options.method === "GET" ||
    options.idempotencyKey !== undefined;
  if (!safeToRepeat) return await once(base, path, options);
  return await keepTrying(() => once(base, path, options), {
    retryable: (error) => isTransient(error, error instanceof ServerError ? error.status : undefined),
    ...(options.onWait === undefined ? {} : { onWait: options.onWait }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.retryBudgetMs === undefined ? {} : { budgetMs: options.retryBudgetMs }),
  });
}

/** One attempt. `request` above decides whether there may be another. */
async function once(base: string, path: string, options: RequestOptions): Promise<unknown> {
  const { method = "GET", body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const headers: Record<string, string> = {
    accept: options.as === "text" ? "text/plain, text/markdown, */*" : "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token !== undefined && token.length > 0) headers["authorization"] = `Bearer ${token}`;
  if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;
  // ⛔ THE HEADER NAME IS THE SERVER'S, spelled once. It is enforced inside `from_request_parts`,
  //    which sees headers and never a body — which is why the proof is a header and not a field.
  if (options.accountProof !== undefined) headers["x-nmts-account-proof"] = options.accountProof;

  let response: Response;
  try {
    // ⛔ Built conditionally rather than passing `body: undefined`: with exactOptionalPropertyTypes
    //    the two are different, and a GET carrying an explicit undefined body is not the same
    //    request as a GET with no body at all.
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(`${base}${path}`, init);
  } catch (error) {
    // ⛔ The cause is named, not swallowed: "fetch failed" alone sends an agent looking at its own
    //    code. A timeout and a refused connection are different problems with different fixes.
    const timedOut = controller.signal.aborted;
    throw new NmtsError(
      timedOut ? `The server did not answer within ${timeoutMs}ms.` : `Could not reach ${base}.`,
      {
        exitCode: 1,
        nextStep: timedOut
          ? "The server may be slow or unreachable. Try again."
          : `Check the address and the network. Cause: ${error instanceof Error ? error.message : String(error)}`,
      },
    );
  } finally {
    clearTimeout(deadline);
  }

  const text = await response.text();
  // ⛔ A TEXT ANSWER IS ONLY TEXT WHEN THE SERVER AGREED. A refusal is JSON however the request
  //    asked, so a failing document fetch still goes through the reading below and still reaches
  //    the caller as a named refusal rather than as a page of HTML pretending to be a notice.
  const asText = options.as === "text" && response.ok;
  let parsed: unknown = null;
  if (text.length > 0 && !asText) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body from an NMTS route means something in front of it answered — a proxy, an
      // access page, an error page. Saying "invalid JSON" would point at the wrong thing.
      throw new NmtsError(`${base} answered ${response.status} with something that is not JSON.`, {
        exitCode: 1,
        nextStep: "Something in front of the server answered. Check the address.",
      });
    }
  }

  // ⛔ The run log's one hook: here, where the outcome is known and nothing has yet been thrown.
  noteRequest(method, path, response.status, isRefusal(parsed) ? parsed.error.message : undefined);
  if (!response.ok) {
    if (isRefusal(parsed)) {
      const wait = response.headers.get("retry-after");
      throw new ServerError(response.status, parsed.error, adviseFor(parsed.error.code), wait !== null && /^\d+$/.test(wait.trim()) ? Number(wait) : null);
    }
    throw new HttpError(response.status, `${base} answered ${response.status}.`);
  }
  if (asText) return { text, filename: filenameFrom(response.headers.get("content-disposition")) };
  return parsed;
}

/**
 * The file name a `Content-Disposition` header gives a body, or null when it names none.
 *
 * ⛔ THE LAST SEGMENT AND NOTHING ELSE. This value came over the network and is on its way to a
 *    name on somebody's disk. `safe-path.ts` contains it as well, and this is the first of the
 *    two: a header saying `filename="../../etc/passwd"` must not survive even as far as being
 *    joined to a directory. Anything that reduces to nothing, `.` or `..` is treated as no name
 *    at all, which the caller answers by refusing rather than by inventing one.
 */
function filenameFrom(header: string | null): string | null {
  const quoted = header === null ? null : /filename="([^"]*)"/u.exec(header);
  const name = (quoted?.[1] ?? "").split(/[/\\]/u).at(-1) ?? "";
  return name === "" || name === "." || name === ".." ? null : name;
}
