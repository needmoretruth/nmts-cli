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
import { NmtsError } from "./errors.js";
import { isTransient, keepTrying } from "./net-retry.js";
/** Default deadline for a request that is not moving file bytes. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** A refusal the server explained. Carries its code so a caller can branch without string matching. */
export class ServerError extends NmtsError {
    status;
    code;
    constructor(status, refusal, nextStep) {
        super(refusal.message, { exitCode: 1, nextStep });
        this.name = "ServerError";
        this.status = status;
        this.code = refusal.code;
    }
}
/** What a caller does next about a refusal, when the tool knows something the message does not. */
function adviseFor(code) {
    switch (code) {
        case "CLEARANCE_REQUIRED":
        case "TURNSTILE_FAILED":
            return ("This account needs a human check, which a command-line tool cannot pass. An API key " +
                "made on the account screen is what waives it — put it in NMTS_API_KEY. If that screen " +
                "has no place to make one, this server does not have API keys switched on.");
        case "UNAUTHORIZED":
            return "The credential is missing or expired. Check NMTS_API_KEY, or make a new key.";
        // ⛔ Each of these says something different on purpose, because the remedies are different
        //    and a program that cannot tell them apart will retry the one thing that cannot work.
        case "API_KEY_REVOKED":
            return "Somebody revoked this key. It will not start working again — make a new one.";
        case "API_KEY_EXPIRED":
            return "This key reached the end of the lifetime it was given. Make a new one.";
        case "API_KEY_SCOPE":
            return ("The key is valid and was not given permission for this. Nothing here will succeed with " +
                "it — a key with the right permissions has to be made on the account screen.");
        case "API_KEY_MALFORMED":
            return ("What was sent is not a well-formed key. Check that the whole string was copied, with " +
                "no quotes or line break — it is one line of exactly 65 characters.");
        case "ACCOUNT_CODE_NOT_A_CREDENTIAL":
            return ("That was an account code, not an API key. The code never goes to the server; it stays " +
                "on this machine and opens the files. Put the code in NMTS_ACCOUNT_CODE and the key in " +
                "NMTS_API_KEY.");
        case "AGENT_VERIFY_REQUIRED":
            return ("This was refused because nothing has checked lately that a person is behind this " +
                "account's key. Ask the person to run `nmts verify` and to follow what it prints — it " +
                "gives them a code to type at a browser, and nothing here can pass that check for them.");
        // ⛔ THE REFUSAL IS CORRECT AND THERE IS NOTHING HERE TO WORK AROUND. Accepting terms is a
        //    person reading a document and agreeing to it; a program doing it for them would be
        //    signing on somebody else's behalf, and this tool holds an API key, not a person. So the
        //    only thing missing was the advice — without it an agent gets a bare 403 and starts
        //    trying credentials, which is the one thing that cannot be the cause.
        //
        // ⚠ It does not say WHICH requests are refused. The server gates some and not others (reading
        //   and deleting are not gated today), that line has moved twice, and a sentence here naming
        //   the list would be a copy of it that nothing keeps true.
        case "TERMS_ACCEPTANCE_REQUIRED":
            return ("This account has not accepted the terms now in force, and the server refuses this " +
                "request until it does. Nothing on this machine can accept them. Ask the person to open " +
                "the account screen at nmts.me and accept there. Other requests may still work in the " +
                "meantime.");
        // ⛔ A KEY IS NOT ENOUGH HERE AND NEVER WILL BE. These routes rebuild what makes the account
        //    recoverable without NMTS, and the owner's rule is that the code is re-entered for them.
        //    An agent that reads this as "my key is wrong" starts making new keys, which is the one
        //    remedy that cannot work.
        case "ACCOUNT_PROOF_REQUIRED":
            return ("This request needs proof of the account code as well as the key, and what was sent was " +
                "missing or did not match. Check that the code this machine is holding belongs to the " +
                "same account as the key. Wrong attempts are counted, and three of them lock these " +
                "routes for a while.");
        case "ACCOUNT_BANNED":
            return "This account is suspended. Nothing here will succeed until that is lifted.";
        // ── Getting to the starting line ──────────────────────────────────────────────────────────
        case "ACCOUNT_EXISTS":
            return "An account already exists for that. Use the one you have rather than making another.";
        case "ALPHA_NOT_OPEN":
            return ("This build asks the server for a channel it does not open. This is not something to " +
                "retry or to fix with a different credential — use a release build.");
        case "API_KEY_CAP":
            return ("The account holds as many live keys as it is allowed. Nothing here can raise the limit: " +
                "the person has to revoke a key they no longer use, on the account screen at nmts.me.");
        case "API_KEY_CHANNEL":
            return ("This account is enrolled on a preview build, and keys are not issued while it is. Ask " +
                "the person to leave the preview on the account screen, then make the key.");
        case "INVALID_CREDENTIALS":
            return ("The server did not accept what was sent. Check the key rather than the account code — " +
                "the code never goes to the server and cannot be the cause.");
        case "LOCKED_OUT":
            return ("Too many failed attempts, so this is shut for a while. Retrying now makes it longer, " +
                "not shorter. The refusal carries the moment it lifts; wait for it.");
        case "RATE_LIMITED":
            return ("Too many requests too quickly. Wait and send fewer — the refusal carries how long. This " +
                "is not a credential problem, so changing keys will not help.");
        case "SURFACE_MISMATCH":
            return ("This account acts through a different build than the one calling. The refusal names " +
                "which; nothing on this machine can change it, and the person switches it at nmts.me.");
        // ── The terms ─────────────────────────────────────────────────────────────────────────────
        case "TERMS_VERSION_MISMATCH":
            return ("The versions sent are not the ones in force; the refusal carries the ones that are. " +
                "This is a stale copy, not a refusal to serve — read the current versions and send those.");
        case "TERMS_NOT_IN_FORCE":
            return ("There is nothing to accept, so accepting cannot be what is missing. This is a server " +
                "condition; report it rather than retrying.");
        // ── Credits and the free trial ────────────────────────────────────────────────────────────
        case "CREDIT_FILE_CAP":
            return ("One file may cost at most the published cap in credits, and this one costs more. The " +
                "refusal carries both numbers. Splitting the file is the way through; more credits is not.");
        case "CREDIT_DAILY_CAP":
            return ("The account has spent its allowance for today. The refusal carries the cap and what is " +
                "spent. Waiting for the day to turn is the only remedy — buying credits does not lift it.");
        case "TRIAL_CLOSED":
            return "The free trial is not open at all right now. Credits have to come from a funded wallet.";
        case "TRIAL_FULL":
            return "This week's free-trial places are taken. Applying again this week cannot succeed; next week can.";
        case "TRIAL_ALREADY":
            return "This account already took the free trial this week. It comes round weekly, not once.";
        case "TRIAL_HELD":
            return "Free-trial applications are paused pending review. Retrying does not move it.";
        case "TRIAL_LINE_CAPPED":
            return ("This internet connection has taken its share of this week's places today — the limit is " +
                "on the connection, not on the account, so another account here hits it too.");
        // ── Storage, the chain, and what is safe to retry ─────────────────────────────────────────
        // ⛔ THE THREE OUTCOMES ARE DIFFERENT AND AN AGENT MUST NOT COLLAPSE THEM. Refused means it did
        //    not happen. Failed means it did not finish. Uncertain means nobody knows — and that is the
        //    one where retrying blindly can spend money twice.
        case "CHAIN_REQUEST_REFUSED":
            return ("The storage service refused the request itself, so nothing was spent and nothing was " +
                "stored. Retrying the same request will be refused the same way.");
        case "CHAIN_REGISTER_FAILED":
            return "Registering the storage did not go through. Nothing is stored; the upload can be tried again.";
        case "CHAIN_CERTIFY_FAILED":
            return ("The bytes went out but the storage was never certified, so the file is not safely stored. " +
                "Try the upload again.");
        case "CHAIN_UNCERTAIN":
            return ("⛔ Nobody knows whether the storage was registered. Do NOT simply retry: doing so can pay " +
                "twice for the same file. Run `nmts ls` first and see whether the file is there.");
        case "CHAIN_SPEND_CAP":
            return ("The service has stopped spending on storage for today. This is not about this account " +
                "and no credential or credit changes it. Try tomorrow.");
        case "CHAIN_DELETE_FAILED":
            return ("The storage could not be released. The file's record is gone from this side either way, " +
                "so nothing here is stuck — the storage runs out on its own when its time is up.");
        case "RELEASE_NOT_SPONSORED":
            return ("This file's storage was not paid for with credits, so it is not the server's to release. " +
                "Storage bought from a wallet is released by that wallet.");
        case "SPONSORED_STATE":
            return ("The upload is not at the step that call belongs to — the steps have an order and one was " +
                "skipped or already done. Start the upload again rather than repeating this call.");
        // ── Two callers, one drive ────────────────────────────────────────────────────────────────
        case "VERSION_CONFLICT":
            return ("Something else changed the drive since this was read. Nothing is lost and nothing is " +
                "wrong with the credential: read the current state and apply the change to that.");
        case "ERASE_BLOCKED":
            return ("The account cannot be erased while retained records still point at it. This will not " +
                "clear by retrying; the records have their own retention and it has to run out.");
        case "CREDITS_SHORT":
            return "The account does not have enough credits for this upload.";
        default:
            return null;
    }
}
function isRefusal(value) {
    if (typeof value !== "object" || value === null || !("error" in value))
        return false;
    const error = Reflect.get(value, "error");
    if (typeof error !== "object" || error === null)
        return false;
    return typeof Reflect.get(error, "code") === "string" && typeof Reflect.get(error, "message") === "string";
}
/**
 * One request to the NMTS server, returning parsed JSON or throwing a named refusal.
 *
 * `path` starts with `/v1/`. It is joined to the base without any normalising, so a caller cannot
 * accidentally send a request to a different host by passing an absolute URL.
 */
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
    const headers = { accept: "application/json" };
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
    let parsed = null;
    if (text.length > 0) {
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
    if (!response.ok) {
        if (isRefusal(parsed)) {
            throw new ServerError(response.status, parsed.error, adviseFor(parsed.error.code));
        }
        throw new NmtsError(`${base} answered ${response.status}.`, { exitCode: 1 });
    }
    return parsed;
}
