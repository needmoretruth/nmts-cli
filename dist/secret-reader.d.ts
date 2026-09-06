export type SecretStep = {
    kind: "more";
} | {
    kind: "done";
    value: string;
} | {
    kind: "cancelled";
};
/**
 * Accumulates typed bytes into a secret.
 *
 * ⛔ `wipe()` is separate from `take()` on purpose: the caller reads the value and only then
 *    clears the buffer. Doing both in one step is what produced the NUL-run defect this file
 *    exists to make impossible.
 */
export declare class SecretReader {
    #private;
    /** Bytes that arrived after the answer ended, for the prompt that comes next. */
    takeLeftover(): Uint8Array;
    /** Feed one chunk. Returns what the caller should do next. */
    push(chunk: Uint8Array): SecretStep;
    /** The value typed so far, with surrounding spaces removed. Clears the buffer. */
    take(): string;
    /** Drop the bytes without reading them. */
    wipe(): void;
    /** How many bytes are held. For tests; never printed. */
    get length(): number;
}
