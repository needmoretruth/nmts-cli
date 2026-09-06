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
import { adviseFor } from "./api-advice.js";
import { NmtsError } from "./errors.js";
import { isTransient, keepTrying } from "./net-retry.js";
import { noteRequest } from "./run-log.js";
/** Default deadline for a request that is not moving file bytes. */
export const DEFAULT_TIMEOUT_MS = 30_000;
import { isRefusal } from "./api-refusal.js";
/** A refusal the server explained. Carries its code so a caller can branch without string matching. */
export class ServerError extends NmtsError {
    status;
    code;
    /** Seconds to wait. ⛔ `Retry-After` is the only place the server sends it — never the body. */
    retryAfter;
    /**
     * Whatever the refusal carried beside its words — the two credit amounts a doubled release fee
     * is refused with, a limit that was hit, an address to go to.
     *
     * ⚠ NOT VALIDATED HERE. It arrives from the network and every reader checks the one field it
     *   wants before printing it; a narrower type would be a claim rather than a check.
     */
    details;
    constructor(status, refusal, nextStep, retryAfter = null) {
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
    status;
    constructor(status, message) {
        super(message, { exitCode: 1 });
        this.name = "HttpError";
        this.status = status;
    }
}
export async function request(base, path, options = {}) {
    if (!path.startsWith("/"))
        throw new NmtsError(`A request path must start with "/": ${path}`);
    // ⛔ REPEATED ONLY WHERE REPEATING IS THE SAME REQUEST. A read always is. A write is only when it
    //    carries an idempotency key, because a request that reached the server and died on the way
    //    back looks exactly like one that never arrived -- and guessing wrong there spends money
    //    twice. Everything else fails once and says so, exactly as it did before.
    const safeToRepeat = options.method === undefined ||
        options.method === "GET" ||
        options.idempotencyKey !== undefined;
    if (!safeToRepeat)
        return await once(base, path, options);
    return await keepTrying(() => once(base, path, options), {
        retryable: (error) => isTransient(error, error instanceof ServerError ? error.status : undefined),
        ...(options.onWait === undefined ? {} : { onWait: options.onWait }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.retryBudgetMs === undefined ? {} : { budgetMs: options.retryBudgetMs }),
    });
}
/** One attempt. `request` above decides whether there may be another. */
async function once(base, path, options) {
    const { method = "GET", body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal)
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const headers = {
        accept: options.as === "text" ? "text/plain, text/markdown, */*" : "application/json",
    };
    if (body !== undefined)
        headers["content-type"] = "application/json";
    if (token !== undefined && token.length > 0)
        headers["authorization"] = `Bearer ${token}`;
    if (options.idempotencyKey !== undefined)
        headers["idempotency-key"] = options.idempotencyKey;
    // ⛔ THE HEADER NAME IS THE SERVER'S, spelled once. It is enforced inside `from_request_parts`,
    //    which sees headers and never a body — which is why the proof is a header and not a field.
    if (options.accountProof !== undefined)
        headers["x-nmts-account-proof"] = options.accountProof;
    let response;
    try {
        // ⛔ Built conditionally rather than passing `body: undefined`: with exactOptionalPropertyTypes
        //    the two are different, and a GET carrying an explicit undefined body is not the same
        //    request as a GET with no body at all.
        const init = { method, headers, signal: controller.signal };
        if (body !== undefined)
            init.body = JSON.stringify(body);
        response = await fetch(`${base}${path}`, init);
    }
    catch (error) {
        // ⛔ The cause is named, not swallowed: "fetch failed" alone sends an agent looking at its own
        //    code. A timeout and a refused connection are different problems with different fixes.
        const timedOut = controller.signal.aborted;
        throw new NmtsError(timedOut ? `The server did not answer within ${timeoutMs}ms.` : `Could not reach ${base}.`, {
            exitCode: 1,
            nextStep: timedOut
                ? "The server may be slow or unreachable. Try again."
                : `Check the address and the network. Cause: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    finally {
        clearTimeout(deadline);
    }
    const text = await response.text();
    // ⛔ A TEXT ANSWER IS ONLY TEXT WHEN THE SERVER AGREED. A refusal is JSON however the request
    //    asked, so a failing document fetch still goes through the reading below and still reaches
    //    the caller as a named refusal rather than as a page of HTML pretending to be a notice.
    const asText = options.as === "text" && response.ok;
    let parsed = null;
    if (text.length > 0 && !asText) {
        try {
            parsed = JSON.parse(text);
        }
        catch {
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
    if (asText)
        return { text, filename: filenameFrom(response.headers.get("content-disposition")) };
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
function filenameFrom(header) {
    const quoted = header === null ? null : /filename="([^"]*)"/u.exec(header);
    const name = (quoted?.[1] ?? "").split(/[/\\]/u).at(-1) ?? "";
    return name === "" || name === "." || name === ".." ? null : name;
}
