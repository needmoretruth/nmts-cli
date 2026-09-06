// What this tool did, written down so that a report can carry it.
//
// ⛔ WHY IT EXISTS. The most useful thing in any report is the sequence: the command that was run,
//    what the server answered, and the sentence it failed with. Asking a person — or an agent — to
//    reconstruct that from memory produces "it did not work", and asking them to paste a terminal
//    produces whatever else was on the screen. So the tool keeps its own record, and `nmts support
//    send --attach-log` is the only thing that reads it.
//
// ⛔ IT IS REDACTED ON THE WAY TO THE DISK, NOT ON THE WAY OUT OF IT. A file that held the real
//    values and was cleaned when it was attached would still be a file full of secrets sitting in
//    a home directory, and a home directory ends up in a backup, a synced folder and a container
//    image. `redact.ts` runs before every write here. The attachment runs it again, which costs
//    nothing and covers a line written by an older version of this tool.
//
// ⛔ WHAT IS NEVER IN IT: file contents, the NMTS key, the API key, a passphrase. Not because
//    they are filtered — because nothing here is ever handed them. What is written is the command
//    name, the argument tokens, the addresses called, the status numbers, and error sentences.
//
// ⛔ WRITING IT MUST NEVER MAKE A COMMAND FAIL. A full disk, a read-only home directory and a
//    config directory owned by somebody else are all ordinary, and none of them is a reason for
//    `nmts get` to report a failure it did not have. Every write is inside a `try` that swallows.
//    ⚠ There is no debug switch in this tool to say so through, so it is silent — which is why
//      this paragraph is here rather than a line of output.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPTIONS_TAKING_A_VALUE } from "./args.js";
import { configDir, modesAreEnforced } from "./credentials.js";
import { redact } from "./redact.js";
import { VERSION } from "./product.js";
/** Set this to `1` and nothing is written. */
export const NO_RUN_LOG_ENV_VAR = "NMTS_NO_RUN_LOG";
/**
 * How much of the log is kept.
 *
 * ⛔ A CAP AND NOT A ROTATION SCHEDULE. This file grows by a few hundred bytes per command and is
 *    read by one command that sends at most 32 KiB of it, so "the newest quarter of a megabyte" is
 *    both more than anybody attaches and small enough that nobody notices it.
 */
export const MAX_LOG_BYTES = 256 * 1024;
/**
 * How many events one run records.
 *
 * ⚠ THE NEWEST ARE KEPT. A run that made two thousand requests failed at the end of them, and the
 *   last twenty are the ones that say why.
 */
const MAX_EVENTS = 100;
/** The most runs `--attach-log` will take. */
export const MAX_ATTACHED_RUNS = 20;
/**
 * Options whose VALUE must never be written down, and what stands in for it.
 *
 * ⛔ `--code`, `--passphrase` AND `--api-key` DO NOT EXIST TODAY, and they are here anyway. The
 *    rule in `args.ts` is that no option carries a secret; this table is what makes the log safe
 *    on the day somebody argues for an exception to it.
 */
const HIDDEN_VALUES = {
    "--message": "[message]",
    "--omit": "[omitted]",
    "--code": "[account-code]",
    "--api-key": "[api-key]",
    "--passphrase": "[secret]",
    "--token": "[secret]",
};
/**
 * What this run has seen so far.
 *
 * ⛔ MODULE STATE, AND IT HAS TO BE. What is being collected is one process's own history, and the
 *    two places that report into it — the request path and the entry point — have no object in
 *    common and should not be given one just for this.
 */
let collected = [];
/** Where the log lives. Inside the tool's own directory, which is already 0700. */
export function runLogPath() {
    return join(configDir(), "runs.jsonl");
}
/** Has the person turned it off? */
export function runLogIsOff() {
    return process.env[NO_RUN_LOG_ENV_VAR] === "1";
}
function remember(event) {
    if (runLogIsOff())
        return;
    collected.push(event);
    if (collected.length > MAX_EVENTS)
        collected = collected.slice(-MAX_EVENTS);
}
/**
 * One request came back. Called from `api.ts`, which is the only place that knows.
 *
 * ⚠ The path is recorded as it was requested, query string and all. Anything secret in it is a
 *   label by the time it lands: `redact` runs over the whole record before it is written.
 */
export function noteRequest(method, path, status, error) {
    remember(error === undefined ? { kind: "http", method, path, status } : { kind: "http", method, path, status, error });
}
/** This run failed, with this sentence. Called from the entry point's own catch. */
export function noteFailure(message) {
    remember({ kind: "error", message });
}
/** Throw away what has been collected. For tests, and for a second run inside one process. */
export function forgetRun() {
    collected = [];
}
/**
 * Which word was the command.
 *
 * ⚠ A HEURISTIC, AND IT IS ALLOWED TO BE. This is a record, not a second parser: the real one runs
 *   inside `run()` and has already thrown by the time a failed command line reaches here. What it
 *   must not do is pick up the VALUE of an option as the command, which is why it skips them.
 */
export function commandOf(argv) {
    const takesValue = new Set(OPTIONS_TAKING_A_VALUE);
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === undefined)
            continue;
        if (takesValue.has(token)) {
            i += 1;
            continue;
        }
        if (token.startsWith("-"))
            continue;
        return token;
    }
    return "";
}
/**
 * The argument tokens, with the values that must not be written replaced by their labels.
 *
 * ⛔ BOTH SPELLINGS. `--message x` and `--message=x` are the same option, and a table that covered
 *    one of them would write the other into the file.
 */
export function safeArgs(argv) {
    const out = [];
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === undefined)
            continue;
        const hidden = HIDDEN_VALUES[token];
        if (hidden !== undefined) {
            out.push(token);
            if (i + 1 < argv.length) {
                out.push(hidden);
                i += 1;
            }
            continue;
        }
        const equals = token.indexOf("=");
        if (equals > 0) {
            const head = token.slice(0, equals);
            const label = HIDDEN_VALUES[head];
            if (label !== undefined) {
                out.push(`${head}=${label}`);
                continue;
            }
        }
        out.push(redact(token));
    }
    return out;
}
/** Write one line, creating the file 0600 if it is not there yet. */
function append(line) {
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = runLogPath();
    if (!existsSync(path)) {
        writeFileSync(path, "", { mode: 0o600 });
        if (modesAreEnforced())
            chmodSync(path, 0o600);
    }
    appendFileSync(path, line);
    if (statSync(path).size > MAX_LOG_BYTES)
        trim(path);
}
/**
 * Drop the oldest whole lines until what is left fits.
 *
 * ⛔ WHOLE LINES. Cutting the file at a byte offset leaves a half-written JSON object at the top,
 *    and a reader that meets one has to decide whether the file is corrupt or merely trimmed.
 */
function trim(path) {
    const lines = readFileSync(path, "utf8").split("\n");
    const kept = [];
    let bytes = 0;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (line === undefined || line === "")
            continue;
        const size = Buffer.byteLength(line, "utf8") + 1;
        if (bytes + size > MAX_LOG_BYTES)
            break;
        kept.unshift(line);
        bytes += size;
    }
    writeFileSync(path, kept.length === 0 ? "" : `${kept.join("\n")}\n`, { mode: 0o600 });
}
/**
 * Write this run down, and forget what was collected.
 *
 * Returns nothing and throws nothing: see the header. A run that could not be written is a run
 * that is missing from a report, which is a smaller problem than a command that failed for it.
 */
export function recordRun(argv, exit, ms, now = new Date()) {
    if (runLogIsOff()) {
        forgetRun();
        return;
    }
    const cmd = commandOf(argv);
    // Everything after the command word is the arguments. A run with no command at all (`--help`,
    // a bare `nmts`) has no such word, and then every token is an argument.
    const from = cmd === "" ? 0 : argv.indexOf(cmd) + 1;
    const record = {
        t: now.toISOString(),
        v: VERSION,
        cmd,
        args: safeArgs(argv.slice(from)),
        exit,
        ms,
        events: collected.map(redactEvent),
    };
    forgetRun();
    try {
        append(`${JSON.stringify(record)}\n`);
    }
    catch {
        // Swallowed on purpose. See the header: the log is a convenience and the command is the work.
    }
}
function redactEvent(event) {
    if (event.kind === "error")
        return { kind: "error", message: redact(event.message) };
    const path = redact(event.path);
    if (event.error === undefined)
        return { kind: "http", method: event.method, path, status: event.status };
    return { kind: "http", method: event.method, path, status: event.status, error: redact(event.error) };
}
function isEvent(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const kind = Reflect.get(value, "kind");
    if (kind === "error")
        return typeof Reflect.get(value, "message") === "string";
    if (kind !== "http")
        return false;
    return (typeof Reflect.get(value, "method") === "string" &&
        typeof Reflect.get(value, "path") === "string" &&
        typeof Reflect.get(value, "status") === "number");
}
/**
 * Read a line back, refusing what this version cannot understand.
 *
 * ⛔ NARROWED, NOT ASSERTED. The file is written by whichever version of this tool ran last, and
 *    the one after it may write a field this one has never heard of. A line that does not parse is
 *    dropped rather than half-read into an attachment.
 */
function asRecord(value) {
    if (typeof value !== "object" || value === null)
        return null;
    const at = (name) => Reflect.get(value, name);
    const args = at("args");
    const events = at("events");
    if (typeof at("t") !== "string" || typeof at("cmd") !== "string")
        return null;
    if (typeof at("exit") !== "number" || !Array.isArray(args) || !Array.isArray(events))
        return null;
    return {
        t: String(at("t")),
        v: typeof at("v") === "string" ? String(at("v")) : "",
        cmd: String(at("cmd")),
        args: args.filter((a) => typeof a === "string"),
        exit: Number(at("exit")),
        ms: typeof at("ms") === "number" ? Number(at("ms")) : 0,
        events: events.filter(isEvent),
    };
}
/** The newest `count` runs, oldest first. An unreadable or missing file is no runs. */
export function readRuns(count) {
    let text;
    try {
        text = readFileSync(runLogPath(), "utf8");
    }
    catch {
        return [];
    }
    const records = [];
    for (const line of text.split("\n")) {
        if (line === "")
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            continue;
        }
        const record = asRecord(parsed);
        if (record !== null)
            records.push(record);
    }
    return count >= records.length ? records : records.slice(records.length - count);
}
