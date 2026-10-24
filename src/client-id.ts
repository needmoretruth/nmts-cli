// Which program is talking to the NMTS server — the value of `x-nmts-client` on every request.
//
// ⛔ WHAT THE SERVER DOES WITH IT, AND NOTHING MORE. It counts, per UTC day, how many accounts used
//    NMTS through the command line, its MCP server and the SDK, and publishes those counts on the
//    public stats page. It keeps the counts and nothing else: no record of which account sent
//    which value. It is not authentication and grants nothing — a request with a different value,
//    or none, is served exactly the same.
//
// ⛔ ONLY ON REQUESTS TO THE NMTS SERVER. `api.ts` builds those and is the one place this is read;
//    a storage network, an RPC node or a release page never sees it.
//
// ⚠ ONE VALUE PER PROCESS. A program that loads this package through the SDK is the SDK, and the
//   command-line tool running as an MCP server is the MCP server, for every request either makes.

import { VERSION } from "./product.ts";

/** The header's name, spelled once. The server's spelling is `api/src/usage/client.rs`. */
export const CLIENT_HEADER = "x-nmts-client";

/** The three programs that send it. Anything else the server counts as "other". */
export type ClientKind = "cli" | "mcp" | "sdk";

let kind: ClientKind = "cli";
let version: string = VERSION;

/**
 * Say which program this process is. The MCP server calls it with `"mcp"`, and the SDK's entry
 * points with `"sdk"` and the SDK's own version.
 */
export function identifyClient(next: ClientKind, nextVersion: string = VERSION): void {
  kind = next;
  version = nextVersion;
}

/** `cli/0.52.0`, `mcp/0.52.0`, `sdk/0.17.0`. */
export function clientHeaderValue(): string {
  return `${kind}/${version}`;
}
