// Showing how far along something is, without making a mess of a pipe.
//
// ⛔ A TERMINAL AND A PIPE ARE DIFFERENT AUDIENCES. A person watching wants one line that rewrites
//    itself; an agent capturing stdout wants text it can read, and a thousand carriage returns in
//    its buffer is noise it has to strip before it can find the answer. So the same reporter
//    behaves differently depending on where it is writing, and the decision is made once, here.
//
// ⛔ IT NEVER WRITES TO STDOUT WHEN THE OUTPUT IS MACHINE-READABLE. `--json` promises one JSON
//    document and nothing else; a progress line would break every parser that trusted that.
export function stderrSink() {
    return {
        // ⛔ STDERR, NOT STDOUT. Progress is not the answer, and a caller redirecting the answer to a
        //    file must not find it interleaved with percentages.
        write: (text) => void process.stderr.write(text),
        interactive: process.stderr.isTTY === true,
    };
}
/** A reporter that says nothing. What `--json` gets, and what a test gets by default. */
export function silentSink() {
    return { write: () => { }, interactive: false };
}
/** How much has to change before a non-interactive sink is told again, as a fraction. */
const PIPE_STEP = 0.1;
/**
 * Report progress through one phase.
 *
 * On a terminal the line rewrites in place, to a tenth of a percent — fine enough that a large
 * upload visibly moves rather than appearing to hang. Into a pipe it prints a plain line every ten
 * percent, which is legible in a log and small enough not to bury the result.
 */
export class Progress {
    sink;
    label;
    lastPrinted = -1;
    dirty = false;
    constructor(sink, label) {
        this.sink = sink;
        this.label = label;
    }
    update(done, total) {
        if (total <= 0)
            return;
        const fraction = Math.min(1, Math.max(0, done / total));
        if (this.sink.interactive) {
            // A tenth of a percent, and never the same number twice: at gigabyte scale the callback
            // fires far more often than the display can change.
            const tenths = Math.floor(fraction * 1000);
            if (tenths === this.lastPrinted)
                return;
            this.lastPrinted = tenths;
            this.dirty = true;
            this.sink.write(`\r  ${this.label} ${(tenths / 10).toFixed(1)}%   `);
            return;
        }
        const step = Math.floor(fraction / PIPE_STEP);
        if (step === this.lastPrinted)
            return;
        this.lastPrinted = step;
        this.sink.write(`  ${this.label} ${Math.round(step * PIPE_STEP * 100)}%\n`);
    }
    /** Finish the line, so whatever prints next starts clean. */
    done() {
        if (this.sink.interactive && this.dirty) {
            this.sink.write(`\r  ${this.label} 100.0%   \n`);
            this.dirty = false;
        }
    }
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
export function countingFetch(onSent, chunkBytes = 256 * 1024) {
    return async (url, init) => {
        const body = init?.body;
        if (!(body instanceof Uint8Array))
            return fetch(url, init);
        const total = body.length;
        let sent = 0;
        const stream = new ReadableStream({
            pull(controller) {
                if (sent >= total) {
                    controller.close();
                    return;
                }
                const end = Math.min(sent + chunkBytes, total);
                controller.enqueue(body.subarray(sent, end));
                sent = end;
                onSent(sent, total);
            },
        });
        const next = {
            ...init,
            body: stream,
            duplex: "half",
        };
        // ⚠ A streaming body has no length the runtime can work out, and some servers need one.
        const headers = new Headers(init?.headers);
        if (!headers.has("content-length"))
            headers.set("content-length", String(total));
        next.headers = headers;
        return fetch(url, next);
    };
}
