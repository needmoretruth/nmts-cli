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
import { checkArgs } from "./mcp-args.js";
import { askerFor } from "./mcp-ask.js";
import { renderError } from "./errors.js";
import { hermesFromParent, hostFromClientInfo } from "./agent-host.js";
/**
 * Protocol versions this server knows how to speak.
 *
 * ⛔ Ordered newest first. If the client asks for one of these it gets that one back; if it asks
 *    for anything else it gets the newest we know, which is what the specification says to do —
 *    guessing that an unknown version is compatible is how a session half-works.
 */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
function isRequest(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    return v["jsonrpc"] === "2.0" && typeof v["method"] === "string";
}
/**
 * A JSON-RPC answer to something WE sent. The client only sends these once this server has started
 * asking questions of its own (see `mcp-ask.ts`), and before that they were reported as malformed
 * requests — which put an error on the wire for a message that was perfectly well formed.
 */
function isResponse(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    if (v["jsonrpc"] !== "2.0" || typeof v["method"] === "string")
        return false;
    return typeof v["id"] === "string" && ("result" in v || "error" in v);
}
/**
 * Answer one request. Returns the response object, or `null` for a notification.
 *
 * Pure apart from the tools it is handed, so the whole protocol is testable without pipes.
 */
export async function handle(request, tools, info) {
    if (!isRequest(request)) {
        return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "not a JSON-RPC 2.0 request" } };
    }
    const id = request.id;
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (request.method) {
        case "initialize": {
            // ⛔ `clientInfo` IS NOT READ HERE, ON PURPOSE. It changes nothing about the answer, and this
            //    function is pure so that the whole protocol can be tested without pipes. Who connected
            //    is a fact about the SESSION, so `serve` reads it out of the same request — see
            //    `clientOf` below.
            const asked = request.params?.["protocolVersion"];
            const version = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
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
            if (tool === undefined)
                return fail(METHOD_NOT_FOUND, `no tool named ${String(name)}`);
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
                const checked = typeof args === "object" && args !== null && !Array.isArray(args) ? { ...args } : {};
                return reply({ content: [{ type: "text", text: await tool.run(checked) }] });
            }
            catch (error) {
                // ⛔ A failed TOOL is not a failed SESSION. The model is told what went wrong and can try
                //    something else; a JSON-RPC error would look to some clients like the server broke.
                //
                // ⛔ AND IT IS TOLD WHAT TO DO NEXT. This used to send `error.message` alone, which threw
                //    away the one line the refusal carries for exactly this reader — the model here has no
                //    terminal to look at and no other source. Forty of the server's fifty-six refusals
                //    carry that line, and none of them reached this path until 2026-08-30. `renderError`
                //    is the same shaping the terminal gets, so the two cannot drift apart.
                return reply({
                    content: [{ type: "text", text: renderError(error, "nmts") }],
                    isError: true,
                });
            }
        }
        default:
            // ⛔ An unknown NOTIFICATION is silence, not an error: a client is allowed to send ones we
            //    have never heard of, and answering would put an unasked-for message on the wire.
            if (id === undefined)
                return null;
            return fail(METHOD_NOT_FOUND, `unknown method ${request.method}`);
    }
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
export function clientOf(request, readParent = hermesFromParent) {
    if (!isRequest(request) || request.method !== "initialize")
        return null;
    const raw = request.params?.["clientInfo"];
    const info = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : undefined;
    const name = typeof info?.name === "string" && info.name !== "" ? info.name : null;
    return { name, host: hostFromClientInfo(info) ?? readParent() };
}
/**
 * What the client said it can do, read out of the same `initialize` request.
 *
 * ⛔ SEPARATE FROM `clientOf` ON PURPOSE. Who is connected and what it can do are different
 *    questions with different consumers, and the first one is deliberately kept usable even when
 *    the client names itself nothing.
 */
export function capabilitiesOf(request) {
    if (!isRequest(request) || request.method !== "initialize")
        return null;
    return request.params?.["capabilities"] ?? null;
}
/** Read newline-delimited JSON-RPC from `input` until it ends, answering on `output`. */
export async function serve(options) {
    const lines = createInterface({ input: options.input, crlfDelay: Infinity });
    // ⛔ IDS WE SEND ARE IN OUR OWN NAMESPACE. JSON-RPC scopes ids per direction, so a client
    //    numbering its requests 1, 2, 3 says nothing about ours. The prefix makes a stray answer
    //    obviously ours to whoever is reading a transcript.
    let asked = 0;
    const waiting = new Map();
    /** Tool calls still in flight. See the note in the loop for why they are not awaited there. */
    const running = new Set();
    const send = (method, params) => {
        asked += 1;
        const id = `nmts-${asked}`;
        return new Promise((resolve) => {
            waiting.set(id, resolve);
            options.output(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
    };
    for await (const line of lines) {
        if (line.trim() === "")
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            options.output(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "invalid JSON" } }));
            continue;
        }
        // An answer to one of ours is routed and never handled as a request.
        if (isResponse(parsed)) {
            const resolve = waiting.get(parsed.id);
            if (resolve !== undefined) {
                waiting.delete(parsed.id);
                // ⛔ An `error` answer resolves with `undefined` rather than throwing. The caller reads
                //    "not an accept" out of that, which is the same no it gives for every other shape it
                //    cannot read — one refusal path instead of two.
                resolve("result" in parsed ? parsed.result : undefined);
            }
            continue;
        }
        const client = clientOf(parsed);
        if (client !== null) {
            options.onClient?.(client);
            options.onAsker?.(askerFor(capabilitiesOf(parsed), send));
        }
        // ⛔ THE LOOP DOES NOT WAIT FOR THE TOOL, AND THAT IS NOT AN OPTIMISATION. This server now
        //    asks the client questions from inside a tool call (`mcp-ask.ts`), and the answer arrives
        //    as another line on this same pipe. Awaiting the tool here would mean the loop cannot read
        //    the answer until the tool finishes, and the tool cannot finish until the answer is read —
        //    a deadlock that no test of the pieces would find, because each piece is correct.
        //
        // ⛔ REPLIES MAY THEREFORE COME BACK OUT OF ORDER, WHICH JSON-RPC ALLOWS: every reply carries
        //    the id it answers. Nothing here shares state between calls, so two in flight cannot see
        //    each other.
        const job = handle(parsed, options.tools, options.info)
            .catch((error) => {
            // The handler itself falling over must not end the session either.
            const message = error instanceof Error ? error.message : "the server failed";
            return { jsonrpc: "2.0", id: null, error: { code: INTERNAL_ERROR, message } };
        })
            .then((response) => {
            if (response !== null)
                options.output(JSON.stringify(response));
        });
        running.add(job);
        void job.finally(() => running.delete(job));
    }
    // ⛔ THE INPUT ENDING IS NOT THE SESSION ENDING. A client that closes the pipe with a tool still
    //    running gets its answer written before this returns; dropping it would lose work already
    //    done, and in the paid tools that means work already charged for.
    await Promise.all(running);
}
