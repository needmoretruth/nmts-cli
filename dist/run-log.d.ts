/** One request this run made, and what came back. */
export interface HttpEvent {
    readonly kind: "http";
    readonly method: string;
    readonly path: string;
    readonly status: number;
    /** The server's own sentence when it refused. Redacted, like everything else here. */
    readonly error?: string;
}
/** One failure this run reported. */
export interface ErrorEvent {
    readonly kind: "error";
    readonly message: string;
}
export type RunEvent = HttpEvent | ErrorEvent;
/** One line of the log. Short field names: the file has a size cap and this is most of it. */
export interface RunRecord {
    /** When the run finished, ISO 8601 in UTC. */
    readonly t: string;
    /** The version that ran. A report about a fixed bug is answered by this field alone. */
    readonly v: string;
    readonly cmd: string;
    readonly args: readonly string[];
    readonly exit: number;
    readonly ms: number;
    readonly events: readonly RunEvent[];
}
/** Set this to `1` and nothing is written. */
export declare const NO_RUN_LOG_ENV_VAR = "NMTS_NO_RUN_LOG";
/**
 * How much of the log is kept.
 *
 * ⛔ A CAP AND NOT A ROTATION SCHEDULE. This file grows by a few hundred bytes per command and is
 *    read by one command that sends at most 32 KiB of it, so "the newest quarter of a megabyte" is
 *    both more than anybody attaches and small enough that nobody notices it.
 */
export declare const MAX_LOG_BYTES: number;
/** The most runs `--attach-log` will take. */
export declare const MAX_ATTACHED_RUNS = 20;
/** Where the log lives. Inside the tool's own directory, which is already 0700. */
export declare function runLogPath(): string;
/** Has the person turned it off? */
export declare function runLogIsOff(): boolean;
/**
 * One request came back. Called from `api.ts`, which is the only place that knows.
 *
 * ⚠ The path is recorded as it was requested, query string and all. Anything secret in it is a
 *   label by the time it lands: `redact` runs over the whole record before it is written.
 */
export declare function noteRequest(method: string, path: string, status: number, error?: string): void;
/** This run failed, with this sentence. Called from the entry point's own catch. */
export declare function noteFailure(message: string): void;
/** Throw away what has been collected. For tests, and for a second run inside one process. */
export declare function forgetRun(): void;
/**
 * Which word was the command.
 *
 * ⚠ A HEURISTIC, AND IT IS ALLOWED TO BE. This is a record, not a second parser: the real one runs
 *   inside `run()` and has already thrown by the time a failed command line reaches here. What it
 *   must not do is pick up the VALUE of an option as the command, which is why it skips them.
 */
export declare function commandOf(argv: readonly string[]): string;
/**
 * The argument tokens, with the values that must not be written replaced by their labels.
 *
 * ⛔ BOTH SPELLINGS. `--message x` and `--message=x` are the same option, and a table that covered
 *    one of them would write the other into the file.
 */
export declare function safeArgs(argv: readonly string[]): string[];
/**
 * Write this run down, and forget what was collected.
 *
 * Returns nothing and throws nothing: see the header. A run that could not be written is a run
 * that is missing from a report, which is a smaller problem than a command that failed for it.
 */
export declare function recordRun(argv: readonly string[], exit: number, ms: number, now?: Date): void;
/** The newest `count` runs, oldest first. An unreadable or missing file is no runs. */
export declare function readRuns(count: number): RunRecord[];
