import type { RunRecord } from "./run-log.ts";
/** What one attachment turned out to be. */
export interface LogAttachment {
    /** The text, oldest run first. Empty when there was nothing to attach. */
    readonly text: string;
    /** How many runs are in it. */
    readonly runs: number;
    /** How many were left out to fit the cap. */
    readonly dropped: number;
    /** What it weighs on the wire. */
    readonly bytes: number;
}
/** The server's ceiling on the log field. `api/src/routes/support.rs` is the origin. */
export declare const MAX_ATTACHMENT_BYTES: number;
/** One run, as a person reads it. */
export declare function formatRun(record: RunRecord): string;
/**
 * Build the attachment.
 *
 * `clean` is the caller's redaction — it runs over each run's own text rather than over the
 * finished attachment, so that a value replaced by a longer label cannot push the result back over
 * the cap after it has been measured.
 */
export declare function buildLogAttachment(records: readonly RunRecord[], clean: (text: string) => string, limit?: number): LogAttachment;
