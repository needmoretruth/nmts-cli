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
