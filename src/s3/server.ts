// The gateway itself: an S3 request in, this account's drive out.
//
// ⛔ LOOPBACK ONLY, AND NO OPTION TO CHANGE IT. The machine running this already holds the NMTS
//    key, and one signature is all that stands between a request and every file in the account.
//    Bound to an address other people can reach, that one signature becomes the whole lock on the
//    account -- and the key it checks was printed on somebody's terminal. This is the same call the
//    rest of the system made on 2026-08-20 when every container port was pulled back to loopback.
//
// ⚠ WHAT EACH REQUEST IS ANSWERED WITH IS IN `routes.ts`, and what a caller has to hand this in
//   `contract.ts`. What is here is the socket and the pair: the two things that decide who can
//   reach the drive at all.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { GatewayOptions } from "./contract.ts";
import { fail, handle } from "./routes.ts";
import type { GatewayCredential } from "./sigv4.ts";

// What a caller hands the gateway, re-exported here so that `./s3/server.ts` is still the one name
// the rest of this package and `s3-gateway.ts` import.
export type { DriveSource, DriveWriter, GatewayOptions } from "./contract.ts";

/** Where the drive is served. Loopback, always — see the note above. */
export const BIND_ADDRESS = "127.0.0.1";

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

/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently.
 */
export function gatewayHandler(options: GatewayOptions): GatewayHandler {
  return (req, res) => {
    handle(req, res, options).catch((error: unknown) => {
      if (!res.headersSent) {
        fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), req.url ?? "/");
      } else {
        res.destroy();
      }
    });
  };
}

export function createGateway(options: GatewayOptions): Server {
  return createServer(gatewayHandler(options));
}
