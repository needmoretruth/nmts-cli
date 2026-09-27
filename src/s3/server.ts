// The gateway itself: an S3 request in, this account's drive out.
//
// ⛔ LOOPBACK ONLY, AND NO OPTION TO CHANGE IT. The machine running this already holds the NMTS
//    key, and one signature is all that stands between a request and every file in the account.
//    Bound to an address other people can reach, that one signature becomes the whole lock on the
//    account -- and the key it checks was printed on somebody's terminal. This is the same call the
//    rest of the system made on 2026-08-20 when every container port was pulled back to loopback.
//
// ⚠ WHICH OPERATION A REQUEST IS, IS DECIDED IN `routes.ts`, and each operation is answered in the
//   file it names (`object-read.ts`, `object-write.ts`, `multipart.ts`); what a caller has to hand
//   this is in `contract.ts`. What is here is the socket and the pair: the two things that decide
//   who can reach the drive at all.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerOptions,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";

import { NmtsError } from "../errors.ts";
import { addressOf } from "./address.ts";
import { answerFor, failureReasonOf, failWith, refuse } from "./answer.ts";
import { headerOf, mayTouch, NOT_YOURS } from "./call.ts";
import type { GatewayOptions } from "./contract.ts";
import { handle } from "./routes.ts";
import { verifyAgainst, type GatewayCredential } from "./sigv4.ts";

// What a caller hands the gateway, re-exported here so that `./s3/server.ts` is still the one name
// the rest of this package and `s3-gateway.ts` import.
export type {
  CopySource,
  DriveSource,
  DriveWriter,
  GatewayOptions,
  StoreOutcome,
  WriteMeta,
} from "./contract.ts";

// Why a response failed, for a server that writes its own log line instead of passing `log`.
export { failureReasonOf } from "./answer.ts";

/** Where the drive is served. Loopback, always — see the note above. */
export const BIND_ADDRESS = "127.0.0.1";

/**
 * How a Node server in front of this gateway is made -- `createServer(GATEWAY_SERVER_OPTIONS, …)`.
 *
 * ⛔ NO LIMIT ON THE WHOLE REQUEST. Node's default gives a request five minutes from its first byte
 *    to its last, and then cuts it: an upload of a few gigabytes over an ordinary line takes longer
 *    than that, and was cut part way every time. What stops a client that holds a connection open
 *    for nothing is the limit on headers, kept here as Node's default because setting the other to
 *    zero would silently take it to zero too, and the idle limit on a body (`BODY_IDLE_MS`).
 */
export const GATEWAY_SERVER_OPTIONS: ServerOptions = { requestTimeout: 0, headersTimeout: 60_000 };

/**
 * How long a request body may go without a byte arriving before the connection is closed.
 *
 * ⚠ ONLY WHILE THE BODY IS ARRIVING. Once its last byte is in, what follows -- a file being sealed
 *   and sent to the storage network, which can take minutes -- is this side's work, and the
 *   connection is not the client's to lose for it. Time the body spends waiting on this side (a
 *   disk that is slow to take it) is not counted either.
 */
export const BODY_IDLE_MS = 120_000;

/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export function newCredential(): GatewayCredential {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const raw = randomBytes(20);
  let id = "NMTS";
  for (const byte of raw) id += letters[byte % letters.length] ?? "A";
  return { accessKeyId: id.slice(0, 20), secretAccessKey: randomBytes(30).toString("base64url") };
}

/** A plain Node request handler, so this can be mounted in somebody else's server. */
export type GatewayHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** One log line, with why the response failed when its client was told less. */
function withReason(line: string, res: ServerResponse): string {
  const why = failureReasonOf(res);
  return why === undefined ? line : `${line} (${why})`;
}

function pathOf(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const at = url.indexOf("?");
  return at < 0 ? url : url.slice(0, at);
}

/** Whether the request says a body follows it. */
function declaresBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  return req.headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0");
}

/**
 * Close the connection when the request's body stops arriving for `idleMs`, until its last byte is in.
 *
 * ⚠ IT WATCHES THE SOCKET'S COUNT OF BYTES, NOT THE BODY'S EVENTS. Listening for the body's data
 *   would start it flowing before whoever reads it is ready. While the body waits on this side --
 *   as many bytes buffered as the stream holds -- the quiet is this side's, and is not counted.
 */
export function watchBodyIdle(req: IncomingMessage, idleMs: number = BODY_IDLE_MS): void {
  if (req.complete || !declaresBody(req)) return;
  let seen = req.socket.bytesRead;
  let quietSince = Date.now();
  const tick = setInterval(
    () => {
      if (req.complete || req.destroyed) {
        clearInterval(tick);
        return;
      }
      const read = req.socket.bytesRead;
      if (read !== seen || req.readableLength >= req.readableHighWaterMark) {
        seen = read;
        quietSince = Date.now();
        return;
      }
      if (Date.now() - quietSince >= idleMs) {
        clearInterval(tick);
        req.socket.destroy();
      }
    },
    Math.max(10, Math.min(5_000, Math.floor(idleMs / 4))),
  );
  tick.unref();
  req.once("end", () => clearInterval(tick));
  req.once("close", () => clearInterval(tick));
}

/**
 * ⛔ TWO PAIRS WITH ONE ID ARE REFUSED BEFORE ANYTHING IS ANSWERED. Which secret, and which bucket
 *    restriction, a request is held to would otherwise be decided by the order of a list. The check
 *    at request time (`sigv4.ts`) answers neither pair for a list changed after this.
 */
function refuseDuplicatePairs(credentials: readonly GatewayCredential[]): void {
  const seen = new Set<string>();
  for (const pair of credentials) {
    if (seen.has(pair.accessKeyId)) {
      throw new NmtsError("GATEWAY_CREDENTIALS: two pairs have the same `accessKeyId`, so which one signs is undecidable.", {
        exitCode: 2,
        nextStep: "Nothing is listening and nothing was opened. Give every pair its own id and make the gateway again.",
      });
    }
    seen.add(pair.accessKeyId);
  }
}

/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently. What it should make that socket with is
 *    `GATEWAY_SERVER_OPTIONS` and `checkContinueHandler`.
 */
export function gatewayHandler(options: GatewayOptions): GatewayHandler {
  refuseDuplicatePairs(options.credentials);
  const log = options.log;
  return (req, res) => {
    watchBodyIdle(req);
    // ⛔ THE LOG HEARS WHY, THE CLIENT DOES NOT. A failure's own words -- a local path, a database's
    //    error, NMTS's refusal -- are answered with a fixed sentence (`answer.ts`), and the line
    //    `routes.ts` writes when the response closes carries them instead, with the path taken out.
    const told = log === undefined ? options : { ...options, log: (line: string) => log(withReason(line, res)) };
    handle(req, res, told).catch((error: unknown) => {
      // A resolver that threw, or a list that could not be read: answered as what it was — a
      // network that did not answer is `SlowDown`, not a fault of this gateway.
      failWith(res, error, pathOf(req));
    });
  };
}

/** A refusal a request earns before its body is read. */
export interface EarlyRefusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * What the request's line and headers alone say it will be refused with, or null when nothing
 * known before its body stands in its way: the signature, and whether the pair may touch the bucket.
 *
 * ⛔ ASKED BEFORE `100 Continue`, SO A REFUSED UPLOAD NEVER SENDS ITS BODY. A client that sends
 *    `Expect: 100-continue` waits for that line before sending gigabytes; Node sends it by itself
 *    unless a server asks first, and then a request whose signature does not hold uploaded its whole
 *    body to be refused at the end. A server that handles `Expect` itself calls this first.
 */
export function refusalBeforeBody(
  req: IncomingMessage,
  options: Pick<GatewayOptions, "credentials" | "now" | "virtualHostBase">,
): EarlyRefusal | null {
  const url = req.url ?? "/";
  const pathname = pathOf(req);
  let verdict: ReturnType<typeof verifyAgainst>;
  try {
    verdict = verifyAgainst(
      { method: (req.method ?? "GET").toUpperCase(), url, headers: req.headers },
      options.credentials,
      options.now?.() ?? Date.now(),
    );
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return { status: 400, code: "InvalidURI", message: "The query string is not valid percent-encoding." };
  }
  if (!verdict.ok) return { status: 403, code: verdict.code, message: verdict.message };
  let bucket: string;
  try {
    bucket = addressOf(pathname, headerOf(req, "host"), options.virtualHostBase).bucket;
  } catch (error) {
    const answer = answerFor(error);
    return { status: answer.status, code: answer.code, message: answer.message };
  }
  if (bucket !== "" && !mayTouch(verdict.credential, bucket)) {
    return { status: 403, code: "AccessDenied", message: NOT_YOURS };
  }
  return null;
}

/**
 * A listener for Node's `checkContinue` event: `100 Continue` and then `then`, or the refusal the
 * request would have earned, answered at once with `Connection: close` so its body is never read.
 */
export function checkContinueHandler(options: GatewayOptions, then: GatewayHandler): GatewayHandler {
  return (req, res) => {
    let refusal: EarlyRefusal | null;
    try {
      refusal = refusalBeforeBody(req, options);
    } catch (error) {
      failWith(res, error, pathOf(req));
      return;
    }
    if (refusal === null) {
      res.writeContinue();
      then(req, res);
      return;
    }
    const log = options.log;
    if (log !== undefined) res.once("close", () => log(`Refused ${res.statusCode}`));
    refuse(res, refusal.status, refusal.code, refusal.message, pathOf(req));
  };
}

export function createGateway(options: GatewayOptions): Server {
  const handler = gatewayHandler(options);
  const server = createServer(GATEWAY_SERVER_OPTIONS, handler);
  server.on("checkContinue", checkContinueHandler(options, handler));
  return server;
}
