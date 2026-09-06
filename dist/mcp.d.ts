import { type Asker } from "./mcp-ask.ts";
import { hermesFromParent, type HostSighting } from "./agent-host.ts";
/** JSON-RPC 2.0, the subset MCP uses. `id` absent means a notification: no answer is sent. */
export interface Request {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** The MCP hints (read-only, destructive, …); listed when present. */
    annotations?: Record<string, boolean>;
    /** Returns the text the model reads. Throwing produces a tool error, not a dead session. */
    run(args: Record<string, unknown>): Promise<string>;
}
/**
 * Protocol versions this server knows how to speak.
 *
 * ⛔ Ordered newest first. If the client asks for one of these it gets that one back; if it asks
 *    for anything else it gets the newest we know, which is what the specification says to do —
 *    guessing that an unknown version is compatible is how a session half-works.
 */
export declare const PROTOCOL_VERSIONS: readonly ["2025-06-18", "2025-03-26", "2024-11-05"];
export interface ServerInfo {
    name: string;
    version: string;
}
/**
 * Answer one request. Returns the response object, or `null` for a notification.
 *
 * Pure apart from the tools it is handed, so the whole protocol is testable without pipes.
 */
export declare function handle(request: unknown, tools: readonly ToolDefinition[], info: ServerInfo): Promise<Record<string, unknown> | null>;
/** What `initialize` said about the client at the other end. */
export interface ClientSighting {
    /** The name the client gave, verbatim, or `null` if it gave none. */
    name: string | null;
    /** The agent host that name belongs to, or `null` when the name belongs to no host we know. */
    host: HostSighting | null;
}
/**
 * Who is on the other end, read out of an `initialize` request. `null` for anything else.
 *
 * ⛔ THE NAME IS KEPT EVEN WHEN IT MATCHES NOTHING. A client calling itself something we have never
 *    heard of is a fact somebody can act on; turning it into `null` throws away the only evidence
 *    that would let a person work out what is talking to them.
 *
 * ⚠ Hermes is the one host that sends no name of its own — the Python SDK's default arrives
 *   instead — so it is looked for in the shape of the parent process, and only where that can be
 *   read. On every other platform Hermes is simply not recognised.
 */
export declare function clientOf(request: unknown, readParent?: typeof hermesFromParent): ClientSighting | null;
/**
 * What the client said it can do, read out of the same `initialize` request.
 *
 * ⛔ SEPARATE FROM `clientOf` ON PURPOSE. Who is connected and what it can do are different
 *    questions with different consumers, and the first one is deliberately kept usable even when
 *    the client names itself nothing.
 */
export declare function capabilitiesOf(request: unknown): unknown;
export interface ServeOptions {
    input: NodeJS.ReadableStream;
    /** Where protocol messages go. NOTHING else may write here. */
    output: (line: string) => void;
    tools: readonly ToolDefinition[];
    info: ServerInfo;
    /** Called once per `initialize`, with whatever the client said about itself. */
    onClient?: (client: ClientSighting) => void;
    /**
     * Called once per `initialize`, with the way to ask this client a question — or `null` when it
     * declared no way to ask. ⛔ It arrives here rather than in `ToolContext` because it cannot exist
     * until the client has spoken, and the tools are built before that.
     */
    onAsker?: (asker: Asker) => void;
}
/** Read newline-delimited JSON-RPC from `input` until it ends, answering on `output`. */
export declare function serve(options: ServeOptions): Promise<void>;
