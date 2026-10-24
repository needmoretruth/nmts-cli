/** The header's name, spelled once. The server's spelling is `api/src/usage/client.rs`. */
export declare const CLIENT_HEADER = "x-nmts-client";
/** The three programs that send it. Anything else the server counts as "other". */
export type ClientKind = "cli" | "mcp" | "sdk";
/**
 * Say which program this process is. The MCP server calls it with `"mcp"`, and the SDK's entry
 * points with `"sdk"` and the SDK's own version.
 */
export declare function identifyClient(next: ClientKind, nextVersion?: string): void;
/** `cli/0.52.0`, `mcp/0.52.0`, `sdk/0.17.0`. */
export declare function clientHeaderValue(): string;
