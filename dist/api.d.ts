import { NmtsError } from "./errors.ts";
import { type WaitReporter } from "./net-retry.ts";
/** Default deadline for a request that is not moving file bytes. */
export declare const DEFAULT_TIMEOUT_MS = 30000;
export type { ServerRefusal } from "./api-refusal.ts";
import type { ServerRefusal } from "./api-refusal.ts";
/** A refusal the server explained. Carries its code so a caller can branch without string matching. */
export declare class ServerError extends NmtsError {
    readonly status: number;
    readonly code: string;
    /** Seconds to wait. ⛔ `Retry-After` is the only place the server sends it — never the body. */
    readonly retryAfter: number | null;
    constructor(status: number, refusal: ServerRefusal, nextStep: string | null, retryAfter?: number | null);
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
export declare class HttpError extends NmtsError {
    readonly status: number;
    constructor(status: number, message: string);
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
export declare function request(base: string, path: string, options: RequestOptions & {
    as: "text";
}): Promise<TextAnswer>;
export declare function request(base: string, path: string, options?: RequestOptions): Promise<unknown>;
