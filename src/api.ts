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

import { NmtsError } from "./errors.ts";

/** Default deadline for a request that is not moving file bytes. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** The envelope the server uses for every refusal: `{ error: { code, message, details? } }`. */
export interface ServerRefusal {
  code: string;
  message: string;
  details?: Record<string, number>;
}

/** A refusal the server explained. Carries its code so a caller can branch without string matching. */
export class ServerError extends NmtsError {
  readonly status: number;
  readonly code: string;

  constructor(status: number, refusal: ServerRefusal, nextStep: string | null) {
    super(refusal.message, { exitCode: 1, nextStep });
    this.name = "ServerError";
    this.status = status;
    this.code = refusal.code;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Session bearer token. Sent in the Authorization header and nowhere else. */
  token?: string | undefined;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

/** What a caller does next about a refusal, when the tool knows something the message does not. */
function adviseFor(code: string): string | null {
  switch (code) {
    case "CLEARANCE_REQUIRED":
    case "TURNSTILE_FAILED":
      return (
        "This account needs a human check, which a command-line tool cannot pass. " +
        "An API key issued from the account screen is what waives it — that is not built yet."
      );
    case "UNAUTHORIZED":
      return "The session is missing or expired. Sign in again.";
    case "ACCOUNT_BANNED":
      return "This account is suspended. Nothing here will succeed until that is lifted.";
    case "CREDITS_SHORT":
      return "The account does not have enough credits for this upload.";
    default:
      return null;
  }
}

function isRefusal(value: unknown): value is { error: ServerRefusal } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error: unknown = Reflect.get(value, "error");
  if (typeof error !== "object" || error === null) return false;
  return typeof Reflect.get(error, "code") === "string" && typeof Reflect.get(error, "message") === "string";
}

/**
 * One request to the NMTS server, returning parsed JSON or throwing a named refusal.
 *
 * `path` starts with `/v1/`. It is joined to the base without any normalising, so a caller cannot
 * accidentally send a request to a different host by passing an absolute URL.
 */
export async function request(base: string, path: string, options: RequestOptions = {}): Promise<unknown> {
  if (!path.startsWith("/")) throw new NmtsError(`A request path must start with "/": ${path}`);
  const { method = "GET", body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token !== undefined && token.length > 0) headers["authorization"] = `Bearer ${token}`;

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
  let parsed: unknown = null;
  if (text.length > 0) {
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

  if (!response.ok) {
    if (isRefusal(parsed)) {
      throw new ServerError(response.status, parsed.error, adviseFor(parsed.error.code));
    }
    throw new NmtsError(`${base} answered ${response.status}.`, { exitCode: 1 });
  }
  return parsed;
}
