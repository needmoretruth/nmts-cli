import { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { GatewayOptions } from "./contract.ts";
import type { GatewayCredential } from "./sigv4.ts";
export type { DriveSource, DriveWriter, GatewayOptions } from "./contract.ts";
/** Where the drive is served. Loopback, always — see the note above. */
export declare const BIND_ADDRESS = "127.0.0.1";
/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export declare function newCredential(): GatewayCredential;
/** A plain Node request handler, so this can be mounted in somebody else's server. */
export type GatewayHandler = (req: IncomingMessage, res: ServerResponse) => void;
/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently.
 */
export declare function gatewayHandler(options: GatewayOptions): GatewayHandler;
export declare function createGateway(options: GatewayOptions): Server;
