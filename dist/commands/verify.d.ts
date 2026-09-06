export interface VerifyOptions {
    server?: string | undefined;
    json?: boolean;
    /** Ask whether the check is live, print the answer, and mint nothing. */
    status?: boolean;
    write?: (line: string) => void;
    /**
     * The wait between asks. Injected by tests so they do not spend the real interval.
     *
     * ⚠ It resolves rather than rejects when the wait is cut short. What cancelling MEANS is decided
     *   in one place below, after the wait, so that an abort during a request and an abort during a
     *   wait end the same way.
     */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    /** A caller's own reason to stop waiting. Joined with the interrupt key. */
    signal?: AbortSignal | undefined;
}
export declare function verify(options?: VerifyOptions): Promise<number>;
