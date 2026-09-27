// How a failure reads to an S3 client: one status and one code, chosen for what the client does next.
//
// ⛔ THE CODE IS AN INSTRUCTION, NOT A LABEL. S3 clients branch on it: `SlowDown` and a 503 mean
//    "wait and send it again", `AccessDenied` means "stop, this pair cannot", `InternalError` means
//    "something broke". Answering 500 for "the account is out of credits" had a sync tool retry an
//    upload that could never succeed until somebody paid, and answering it for "the storage network
//    did not answer" told the same tool to give up on a request a minute's wait would have carried.
//
// ⚠ EVERY FIELD IS READ AS UNKNOWN. What reaches this file was thrown by the command-line tool, by
//   the SDK, by Node or by a business's own resolver; none of them promised a shape, so `code`,
//   `status` and `retryAfter` are each looked up and type-checked rather than assumed.

import type { IncomingMessage, ServerResponse } from "node:http";

import { BodyRefusal } from "./body.ts";
import { isKeyConflict } from "./same-file.ts";
import { errorXml } from "./xml.ts";

/** A refusal this gateway decided on, carrying the S3 status and code it is answered with. */
export class S3Refusal extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "S3Refusal";
    this.status = status;
    this.code = code;
  }
}

/** One failure, as the error document and headers an S3 client reads. */
export interface S3Answer {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Seconds a client should wait before sending it again, when anything said. */
  readonly retryAfter: number | null;
  /**
   * What the client was not told: the failure's own code or name and its own words, for whoever
   * runs the gateway. Null when `message` already says everything there is.
   */
  readonly reason: string | null;
}

/** One kind of failure, as every S3 client is told it. */
interface Kind {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * What each kind of failure is answered with: the status, the code and one fixed sentence.
 *
 * ⛔ THE SENTENCE IS THIS GATEWAY'S, NOT THE FAILURE'S. What was thrown is written for whoever runs
 *    NMTS on the machine: a local path with a process id in it, a database's own error, the next
 *    command for a person to type. Through a business's gateway the client is somebody else
 *    entirely, and those words are about the business, not about the request. They go to the
 *    gateway's log instead (`failureReasonOf`).
 */
const KINDS = {
  /** The account cannot pay for this: no retry will change that until somebody acts. */
  account: {
    status: 403,
    code: "AccountProblem",
    message:
      "The account this bucket belongs to cannot pay for this: it is short of credits or over a " +
      "spending limit. Sending it again will not help until that changes.",
  },
  /** Whoever the account is reached through may not do this, now or with this credential. */
  denied: {
    status: 403,
    code: "AccessDenied",
    message:
      "The account this bucket belongs to does not allow this request. Sending it again will not " +
      "help until that changes.",
  },
  /** Not now, but later: the request itself was fine. */
  later: {
    status: 503,
    code: "SlowDown",
    message: "NMTS or the storage network could not take this request just now. Send it again after a short wait.",
  },
  /**
   * The upload or the account moved on while this ran; a new request starts from where it is now.
   *
   * ⚠ `OperationAborted` BECAUSE A 409 IS NOT RETRIED BLINDLY. The AWS SDKs and botocore retry by
   *   themselves on 500, 502, 503 and 504 and on lists of throttling and transient codes; 409 is not
   *   among those statuses and `OperationAborted` is on none of those lists, so the application
   *   hears it once. Its meaning in S3 -- a conflicting operation on this resource, to be tried
   *   again -- is what these refusals are: the same request sent again is a new upload from the start.
   */
  conflict: {
    status: 409,
    code: "OperationAborted",
    message:
      "Something else changed this upload or this account while the request ran. Send it again as a new request.",
  },
  /** Refused as it was sent: the same request again gets the same answer. */
  refused: {
    status: 400,
    code: "InvalidRequest",
    message: "NMTS refused this request as it was sent. Sending it again unchanged will not help.",
  },
  notDone: { status: 501, code: "NotImplemented", message: "NMTS does not do this yet." },
  /** S3's own words for its own 500. */
  internal: { status: 500, code: "InternalError", message: "We encountered an internal error. Please try again." },
} as const satisfies Record<string, Kind>;

type KindName = keyof typeof KINDS;

interface Row {
  readonly kind: KindName;
  readonly codes: readonly string[];
  readonly status: (status: number) => boolean;
}

/**
 * NMTS's refusals and what each is answered as: by its code first, then by its status.
 *
 * ⛔ ONE TABLE. A code is listed where it says more than its status does -- `CREDITS_SHORT` is a 409
 *    on the wire and an account that cannot pay here -- or where it may arrive without a status, as
 *    `WALLET_SHORT` does. Every other refusal is placed by its status alone, which is how a code
 *    NMTS adds tomorrow still lands somewhere a client acts on sensibly. Rows are read in order.
 */
const TABLE: readonly Row[] = [
  {
    kind: "account",
    codes: ["CREDITS_SHORT", "CREDIT_FILE_CAP", "CREDIT_DAILY_CAP", "WALLET_SHORT", "DEPOSIT_FEE_INSUFFICIENT"],
    status: (s) => s === 402,
  },
  {
    kind: "denied",
    codes: [
      "DELEGATION_INVALID",
      "DELEGATION_EXPIRED",
      "DELEGATION_SCOPE",
      "NOT_A_MEMBER",
      "API_KEY_REVOKED",
      "API_KEY_EXPIRED",
      "API_KEY_SCOPE",
      "TERMS_ACCEPTANCE_REQUIRED",
      "ACCOUNT_BANNED",
    ],
    status: (s) => s === 401 || s === 403,
  },
  { kind: "later", codes: ["RATE_LIMITED", "CHAIN_SPEND_CAP", "CHAIN_UNCERTAIN"], status: (s) => s === 429 },
  { kind: "conflict", codes: ["SPONSORED_IDEM_MISMATCH", "SPONSORED_STATE"], status: (s) => s === 409 },
  { kind: "notDone", codes: ["NOT_IMPLEMENTED"], status: (s) => s === 501 },
  { kind: "later", codes: [], status: (s) => s >= 500 },
  { kind: "refused", codes: [], status: (s) => s >= 400 && s < 500 },
];

/**
 * How long a client is asked to wait after the storage network did not take the bytes, when nothing
 * named a wait. The storage is paid for and the bytes are kept, so the retry costs only the push.
 */
export const PUSH_RETRY_AFTER_SECONDS = 5;

/** Node's names for a connection that was never made or did not last. */
const UNREACHABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * The sentences this package throws when NMTS or the storage network did not answer.
 *
 * ⚠ ANCHORED TO THOSE SENTENCES. A looser pattern — the word "network" anywhere — also matches a
 *   refusal such as "a file on a network this build cannot read", and answering that with
 *   `SlowDown` has a client retry forever something that will never work.
 */
const UNREACHABLE_WORDS =
  /^Could not reach |^fetch failed$|did not answer within \d+ ?ms|could not be read from the .+ storage network/;

function field(error: unknown, name: string): unknown {
  if (typeof error !== "object" || error === null || !(name in error)) return undefined;
  return Reflect.get(error, name);
}

function stringField(error: unknown, name: string): string | null {
  const value = field(error, name);
  return typeof value === "string" ? value : null;
}

function numberField(error: unknown, name: string): number | null {
  const value = field(error, name);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** True when a failure is a connection to NMTS or the storage network that did not happen. */
function unreachable(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) return false;
  const code = stringField(error, "code");
  if (code !== null && UNREACHABLE_CODES.has(code)) return true;
  if (error instanceof Error && UNREACHABLE_WORDS.test(error.message)) return true;
  return unreachable(field(error, "cause"), depth + 1);
}

/** The step of an upload a failure names: "uploading" is the push of paid-for bytes to the relay. */
function pushFailed(error: unknown): boolean {
  return stringField(error, "phase") === "uploading";
}

/**
 * Which kind a failure is, when it is anything other than an accident.
 *
 * ⚠ A PUSH THE STORAGE NETWORK DID NOT TAKE IS READ BY ITS PHASE, NOT ITS WORDS. Its sentence starts
 *   with what was being done, which is why no pattern over sentences caught it.
 * ⚠ EXIT CODES 2 AND 4 ARE THIS PACKAGE REFUSING ITS INPUT -- a name the drive cannot hold, an empty
 *   file -- so what was refused is the client's request, not something that broke.
 */
function kindOf(error: unknown): KindName | null {
  const code = stringField(error, "code");
  if (code !== null) {
    const row = TABLE.find((r) => r.codes.includes(code));
    if (row !== undefined) return row.kind;
  }
  const status = numberField(error, "status");
  if (status !== null) {
    const row = TABLE.find((r) => r.status(status));
    if (row !== undefined) return row.kind;
  }
  if (pushFailed(error) || unreachable(error)) return "later";
  const exit = numberField(error, "exitCode");
  if (exit === 2 || exit === 4) return "refused";
  return null;
}

/** Long enough for any sentence this package throws; a log line is no place for a stack. */
const MAX_REASON = 400;

/** The failure's own code or name and its own words, as one line for whoever runs the gateway. */
function reasonOf(error: unknown): string {
  const label = stringField(error, "code") ?? (error instanceof Error ? error.name : typeof error);
  const words = error instanceof Error ? error.message : String(error);
  return `${label}: ${words}`.replace(/\s+/g, " ").slice(0, MAX_REASON);
}

/** What an S3 client should be told about a thrown value. */
export function answerFor(error: unknown): S3Answer {
  const message = error instanceof Error ? error.message : String(error);
  // The refusals this gateway phrased itself: their words were written for the client.
  if (error instanceof S3Refusal || error instanceof BodyRefusal) {
    return { status: error.status, code: error.code, message, retryAfter: null, reason: null };
  }
  // ⛔ A KEY THAT HOLDS A DIFFERENT FILE IS 409, NOT 500 — the request was well formed and the
  //    drive declined it. Told 500 a sync tool retries the upload forever; told 409 it records a
  //    conflict and moves on. ⚠ The code stays `InvalidRequest`: the S3 codes that come with a 409
  //    and are not about buckets (`OperationAborted`, `ConditionalRequestConflict`) both mean "try
  //    again", which is the one thing that will never help here.
  if (isKeyConflict(error)) return { status: 409, code: "InvalidRequest", message, retryAfter: null, reason: null };

  const name = kindOf(error) ?? "internal";
  const kind: Kind = KINDS[name];
  let retryAfter: number | null = null;
  if (name === "later") {
    const wait = numberField(error, "retryAfter");
    if (wait !== null) retryAfter = Math.max(0, Math.ceil(wait));
    else if (pushFailed(error)) retryAfter = PUSH_RETRY_AFTER_SECONDS;
  }
  return { status: kind.status, code: kind.code, message: kind.message, retryAfter, reason: reasonOf(error) };
}

/**
 * Why each failed response failed, in more words than its client was given.
 *
 * ⛔ HELD BESIDE THE RESPONSE, NOT PASSED BACK UP. The code that answers a failure is deep inside an
 *    operation and knows nothing of the log; whoever holds the log reads this when the response
 *    closes. A weak map, so a response nobody asks about takes its reason with it.
 */
const REASONS = new WeakMap<ServerResponse, string>();

/**
 * Why this response failed, for whoever runs the gateway: undefined when it did not, or when its
 * client was told everything there was.
 *
 * ⛔ NEVER A KEY. The request's path, and each of its segments, is taken out of the reason, since a
 *    failure's words may quote the file it was about and the log never names a file.
 */
export function failureReasonOf(res: ServerResponse): string | undefined {
  return REASONS.get(res);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with the request's path replaced wherever it stands as a word: every tail of it (the key
 * without its bucket, the name without its folders) and every segment on its own.
 */
function withoutPath(text: string, resource: string): string {
  let decoded = resource;
  try {
    decoded = decodeURIComponent(resource);
  } catch {
    // A path with a broken escape is taken out as it arrived.
  }
  const names = new Set<string>();
  for (const path of [resource, decoded]) {
    const segments = path.split("/");
    segments.forEach((segment, at) => {
      names.add(segment);
      names.add(segments.slice(at).join("/"));
    });
  }
  let out = text;
  for (const name of [...names].filter((n) => n.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "gu"), "…");
  }
  return out;
}

/** Keep why this response failed, when its client was told less than that. */
export function noteFailure(res: ServerResponse, answer: S3Answer, resource: string): void {
  if (answer.reason !== null) REASONS.set(res, withoutPath(answer.reason, resource));
}

/**
 * Whether the request is still sending a body that nothing has read.
 *
 * ⛔ SUCH A REQUEST IS ANSWERED WITH `Connection: close`. Kept open, the connection would have to
 *    take in every byte of a body that was already refused -- gigabytes of an upload whose
 *    signature did not hold -- before it could carry the next request; closed, the reading stops
 *    with the answer. A client that sent `Expect: 100-continue` and is refused never sends it at all.
 */
function bodyStillComing(res: ServerResponse): boolean {
  const req: IncomingMessage | undefined = res.req;
  if (req === undefined || req.complete) return false;
  const length = req.headers["content-length"];
  return req.headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0");
}

/** Answer with an XML body, or with its headers alone for a HEAD. */
export function sendXml(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...extra,
    ...(bodyStillComing(res) ? { connection: "close" } : {}),
    "content-type": "application/xml",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** Answer one refusal as the error document S3 sends. */
export function refuse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  resource: string,
  extra: Record<string, string> = {},
): void {
  sendXml(res, status, errorXml(code, message, resource), extra);
}

/**
 * Answer whatever was thrown, if the response can still carry an answer.
 *
 * ⛔ A RESPONSE THAT HAS BEGUN IS DESTROYED, NOT ENDED. Its status and length went out already; a
 *    clean end after a short body is what every client files away as a whole file.
 */
export function failWith(res: ServerResponse, error: unknown, resource: string): void {
  const answer = answerFor(error);
  noteFailure(res, answer, resource);
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy();
    return;
  }
  refuse(
    res,
    answer.status,
    answer.code,
    answer.message,
    resource,
    answer.retryAfter === null ? {} : { "retry-after": String(answer.retryAfter) },
  );
}
