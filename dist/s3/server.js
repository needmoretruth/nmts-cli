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
import { createServer, } from "node:http";
import { randomBytes } from "node:crypto";
import { NmtsError } from "../errors.js";
import { addressOf } from "./address.js";
import { answerFor, failureReasonOf, failWith, refuse } from "./answer.js";
import { headerOf, mayTouch, NOT_YOURS } from "./call.js";
import { handle } from "./routes.js";
import { verifyAgainst } from "./sigv4.js";
// Why a response failed, for a server that writes its own log line instead of passing `log`.
export { failureReasonOf } from "./answer.js";
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
export const GATEWAY_SERVER_OPTIONS = { requestTimeout: 0, headersTimeout: 60_000 };
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
export function newCredential() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const raw = randomBytes(20);
    let id = "NMTS";
    for (const byte of raw)
        id += letters[byte % letters.length] ?? "A";
    return { accessKeyId: id.slice(0, 20), secretAccessKey: randomBytes(30).toString("base64url") };
}
/** One log line, with why the response failed when its client was told less. */
function withReason(line, res) {
    const why = failureReasonOf(res);
    return why === undefined ? line : `${line} (${why})`;
}
function pathOf(req) {
    const url = req.url ?? "/";
    const at = url.indexOf("?");
    return at < 0 ? url : url.slice(0, at);
}
/** Whether the request says a body follows it. */
function declaresBody(req) {
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
export function watchBodyIdle(req, idleMs = BODY_IDLE_MS) {
    if (req.complete || !declaresBody(req))
        return;
    let seen = req.socket.bytesRead;
    let quietSince = Date.now();
    const tick = setInterval(() => {
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
    }, Math.max(10, Math.min(5_000, Math.floor(idleMs / 4))));
    tick.unref();
    req.once("end", () => clearInterval(tick));
    req.once("close", () => clearInterval(tick));
}
/**
 * ⛔ TWO PAIRS WITH ONE ID ARE REFUSED BEFORE ANYTHING IS ANSWERED. Which secret, and which bucket
 *    restriction, a request is held to would otherwise be decided by the order of a list. The check
 *    at request time (`sigv4.ts`) answers neither pair for a list changed after this.
 */
function refuseDuplicatePairs(credentials) {
    const seen = new Set();
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
export function gatewayHandler(options) {
    refuseDuplicatePairs(options.credentials);
    const log = options.log;
    return (req, res) => {
        watchBodyIdle(req);
        // ⛔ THE LOG HEARS WHY, THE CLIENT DOES NOT. A failure's own words -- a local path, a database's
        //    error, NMTS's refusal -- are answered with a fixed sentence (`answer.ts`), and the line
        //    `routes.ts` writes when the response closes carries them instead, with the path taken out.
        const told = log === undefined ? options : { ...options, log: (line) => log(withReason(line, res)) };
        handle(req, res, told).catch((error) => {
            // A resolver that threw, or a list that could not be read: answered as what it was — a
            // network that did not answer is `SlowDown`, not a fault of this gateway.
            failWith(res, error, pathOf(req));
        });
    };
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
export function refusalBeforeBody(req, options) {
    const url = req.url ?? "/";
    const pathname = pathOf(req);
    let verdict;
    try {
        verdict = verifyAgainst({ method: (req.method ?? "GET").toUpperCase(), url, headers: req.headers }, options.credentials, options.now?.() ?? Date.now());
    }
    catch (error) {
        if (!(error instanceof URIError))
            throw error;
        return { status: 400, code: "InvalidURI", message: "The query string is not valid percent-encoding." };
    }
    if (!verdict.ok)
        return { status: 403, code: verdict.code, message: verdict.message };
    let bucket;
    try {
        bucket = addressOf(pathname, headerOf(req, "host"), options.virtualHostBase).bucket;
    }
    catch (error) {
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
export function checkContinueHandler(options, then) {
    return (req, res) => {
        let refusal;
        try {
            refusal = refusalBeforeBody(req, options);
        }
        catch (error) {
            failWith(res, error, pathOf(req));
            return;
        }
        if (refusal === null) {
            res.writeContinue();
            then(req, res);
            return;
        }
        const log = options.log;
        if (log !== undefined)
            res.once("close", () => log(`Refused ${res.statusCode}`));
        refuse(res, refusal.status, refusal.code, refusal.message, pathOf(req));
    };
}
export function createGateway(options) {
    const handler = gatewayHandler(options);
    const server = createServer(GATEWAY_SERVER_OPTIONS, handler);
    server.on("checkContinue", checkContinueHandler(options, handler));
    return server;
}
