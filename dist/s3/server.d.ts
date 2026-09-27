import { type IncomingMessage, type Server, type ServerOptions, type ServerResponse } from "node:http";
import type { GatewayOptions } from "./contract.ts";
import { type GatewayCredential } from "./sigv4.ts";
export type { CopySource, DriveSource, DriveWriter, GatewayOptions, StoreOutcome, WriteMeta, } from "./contract.ts";
export { failureReasonOf } from "./answer.ts";
/** Where the drive is served. Loopback, always — see the note above. */
export declare const BIND_ADDRESS = "127.0.0.1";
/**
 * How a Node server in front of this gateway is made -- `createServer(GATEWAY_SERVER_OPTIONS, …)`.
 *
 * ⛔ NO LIMIT ON THE WHOLE REQUEST. Node's default gives a request five minutes from its first byte
 *    to its last, and then cuts it: an upload of a few gigabytes over an ordinary line takes longer
 *    than that, and was cut part way every time. What stops a client that holds a connection open
 *    for nothing is the limit on headers, kept here as Node's default because setting the other to
 *    zero would silently take it to zero too, and the idle limit on a body (`BODY_IDLE_MS`).
 */
export declare const GATEWAY_SERVER_OPTIONS: ServerOptions;
/**
 * How long a request body may go without a byte arriving before the connection is closed.
 *
 * ⚠ ONLY WHILE THE BODY IS ARRIVING. Once its last byte is in, what follows -- a file being sealed
 *   and sent to the storage network, which can take minutes -- is this side's work, and the
 *   connection is not the client's to lose for it. Time the body spends waiting on this side (a
 *   disk that is slow to take it) is not counted either.
 */
export declare const BODY_IDLE_MS = 120000;
/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export declare function newCredential(): GatewayCredential;
/** A plain Node request handler, so this can be mounted in somebody else's server. */
export type GatewayHandler = (req: IncomingMessage, res: ServerResponse) => void;
/**
 * Close the connection when the request's body stops arriving for `idleMs`, until its last byte is in.
 *
 * ⚠ IT WATCHES THE SOCKET'S COUNT OF BYTES, NOT THE BODY'S EVENTS. Listening for the body's data
 *   would start it flowing before whoever reads it is ready. While the body waits on this side --
 *   as many bytes buffered as the stream holds -- the quiet is this side's, and is not counted.
 */
export declare function watchBodyIdle(req: IncomingMessage, idleMs?: number): void;
/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently. What it should make that socket with is
 *    `GATEWAY_SERVER_OPTIONS` and `checkContinueHandler`.
 */
export declare function gatewayHandler(options: GatewayOptions): GatewayHandler;
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
export declare function refusalBeforeBody(req: IncomingMessage, options: Pick<GatewayOptions, "credentials" | "now" | "virtualHostBase">): EarlyRefusal | null;
/**
 * A listener for Node's `checkContinue` event: `100 Continue` and then `then`, or the refusal the
 * request would have earned, answered at once with `Connection: close` so its body is never read.
 */
export declare function checkContinueHandler(options: GatewayOptions, then: GatewayHandler): GatewayHandler;
export declare function createGateway(options: GatewayOptions): Server;
