/**
 * Somewhere a file's plaintext is delivered in order, and made visible only once.
 *
 * The shape is three-part on purpose: `write` moves bytes, `commit` is the only thing that may
 * make them readable under the name somebody asked for, and `abandon` must leave nothing behind.
 * A destination that cannot separate those three cannot hold the integrity promise above.
 */
export interface PlaintextSink {
    /**
     * The file's real length, from the sealed list, BEFORE a single stored part is fetched.
     *
     * ⛔ A destination that cannot take a file this size refuses HERE, where nothing has been read
     *    from the network and nothing has been written. Discovering it half way through means the
     *    refusal costs a download that was never going to be delivered.
     */
    expect(size: number): void;
    /** Take the next run of plaintext, in order. Resolves when the bytes are no longer needed. */
    write(bytes: Uint8Array): Promise<void>;
    /**
     * Everything checked: make the file visible, or hand it over.
     *
     * False means the reader closed the pipe before the file was done — see `handOver`. Every other
     * failure throws: a caller must not be able to mistake "it stopped half way" for "delivered".
     */
    commit(): Promise<boolean>;
    /** Something did not check out: leave nothing behind. Never throws. */
    abandon(): Promise<void>;
}
