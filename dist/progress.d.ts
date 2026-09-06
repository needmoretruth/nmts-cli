/** Where a report goes. Split out so a test can drive it without a terminal. */
export interface ProgressSink {
    write(text: string): void;
    /** True for a terminal that can rewrite its last line. */
    interactive: boolean;
}
export declare function stderrSink(): ProgressSink;
/** A reporter that says nothing. What `--json` gets, and what a test gets by default. */
export declare function silentSink(): ProgressSink;
/**
 * Report progress through one phase.
 *
 * On a terminal the line rewrites in place, to a tenth of a percent — fine enough that a large
 * upload visibly moves rather than appearing to hang. Into a pipe it prints a plain line every ten
 * percent, which is legible in a log and small enough not to bury the result.
 */
export declare class Progress {
    private readonly sink;
    private readonly label;
    private lastPrinted;
    private dirty;
    constructor(sink: ProgressSink, label: string);
    update(done: number, total: number): void;
    /** Finish the line, so whatever prints next starts clean. */
    done(): void;
}
/**
 * A `fetch` that counts the bytes of the request body as they go out.
 *
 * ⛔ THE BODY IS RE-WRAPPED, NOT RE-READ. The bytes are handed to the request as a stream that
 *    reports each chunk on its way past, so nothing is copied and the count is what actually left
 *    rather than what was queued.
 *
 * ⚠ `duplex: "half"` is required by the fetch specification for a streaming body and Node enforces
 *   it. Without it the request throws before a single byte is sent.
 */
export declare function countingFetch(onSent: (sent: number, total: number) => void, chunkBytes?: number): (url: RequestInfo, init?: RequestInit) => Promise<Response>;
