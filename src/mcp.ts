// The Model Context Protocol, spoken over stdin/stdout, with no library.
//
// ⛔ WHY NO SDK. This package promises that a separate licence can be arranged, and that promise is
//    only true while every line of it is ours to license. Each dependency is a copy of somebody
//    else's copyright riding along — a check enforces that they are all permissive, but the surface
//    here is small enough that not adding one is simply better. MCP over stdio is JSON-RPC 2.0 in
//    newline-delimited JSON; that is the whole transport.
//
// ⛔ STDOUT IS THE WIRE. Anything printed there that is not a protocol message corrupts the session
//    — the client sees a parse error and the tools vanish. So nothing in this file writes to stdout
//    except `send`, and everything a person should read goes to stderr. A test holds that line.
//
// ⚠ WHAT THIS IS NOT: it is not a sandbox. A tool call here can read the account's file list and
//   write a file into the directory the person chose when they started the server. It cannot reach
//   anywhere else on disk, and it cannot make or revoke a key — those need a person at a browser.
import { createInterface } from "node:readline";

import { checkArgs } from "./mcp-args.ts";

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
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function isRequest(value: unknown): value is Request {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["jsonrpc"] === "2.0" && typeof v["method"] === "string";
}

export interface ServerInfo {
  name: string;
  version: string;
}

/**
 * Answer one request. Returns the response object, or `null` for a notification.
 *
 * Pure apart from the tools it is handed, so the whole protocol is testable without pipes.
 */
export async function handle(
  request: unknown,
  tools: readonly ToolDefinition[],
  info: ServerInfo,
): Promise<Record<string, unknown> | null> {
  if (!isRequest(request)) {
    return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "not a JSON-RPC 2.0 request" } };
  }
  const id = request.id;
  const reply = (result: Record<string, unknown>) => ({ jsonrpc: "2.0" as const, id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

  switch (request.method) {
    case "initialize": {
      const asked = request.params?.["protocolVersion"];
      const version =
        typeof asked === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion: version, capabilities: { tools: {} }, serverInfo: info });
    }
    // Notifications carry no id and get no answer. Returning one would be a protocol error.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = request.params?.["name"];
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) return fail(METHOD_NOT_FOUND, `no tool named ${String(name)}`);
      // ⛔ THE SCHEMA IS CHECKED HERE, ONCE, FOR EVERY TOOL. It used to be advertised and never
      //    enforced: anything that was not an object became `{}` and everything else went straight
      //    through, so a tool declaring `dry_run: boolean` was handed the STRING "true" and its
      //    `=== true` test read it as false — a request for a price became a paid upload. Checking
      //    in each tool would be the same four checks written twenty times, and the twentieth would
      //    forget. ⛔ A wrong argument is REFUSED, never repaired: guessing what `"true"` meant is
      //    deciding on the caller's behalf which branch spends money.
      const raw = request.params?.["arguments"];
      const args = raw === undefined ? {} : raw;
      const problems = checkArgs(tool.inputSchema, args);
      if (problems.length > 0) {
        return reply({
          content: [{ type: "text", text: `${tool.name}: ${problems.join("; ")}` }],
          isError: true,
        });
      }
      try {
        // Narrowed by the check above: `checkArgs` refuses anything that is not an object.
        const checked: Record<string, unknown> =
          typeof args === "object" && args !== null && !Array.isArray(args) ? { ...args } : {};
        return reply({ content: [{ type: "text", text: await tool.run(checked) }] });
      } catch (error) {
        // ⛔ A failed TOOL is not a failed SESSION. The model is told what went wrong and can try
        //    something else; a JSON-RPC error would look to some clients like the server broke.
        const message = error instanceof Error ? error.message : "the tool failed";
        return reply({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      // ⛔ An unknown NOTIFICATION is silence, not an error: a client is allowed to send ones we
      //    have never heard of, and answering would put an unasked-for message on the wire.
      if (id === undefined) return null;
      return fail(METHOD_NOT_FOUND, `unknown method ${request.method}`);
  }
}

export interface ServeOptions {
  input: NodeJS.ReadableStream;
  /** Where protocol messages go. NOTHING else may write here. */
  output: (line: string) => void;
  tools: readonly ToolDefinition[];
  info: ServerInfo;
}

/** Read newline-delimited JSON-RPC from `input` until it ends, answering on `output`. */
export async function serve(options: ServeOptions): Promise<void> {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      options.output(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "invalid JSON" } }),
      );
      continue;
    }
    let response: Record<string, unknown> | null;
    try {
      response = await handle(parsed, options.tools, options.info);
    } catch (error) {
      // The handler itself falling over must not end the session either.
      const message = error instanceof Error ? error.message : "the server failed";
      response = { jsonrpc: "2.0", id: null, error: { code: INTERNAL_ERROR, message } };
    }
    if (response !== null) options.output(JSON.stringify(response));
  }
}
