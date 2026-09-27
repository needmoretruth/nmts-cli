/** A lock per name. */
export interface KeyLocks {
    /**
     * Run `work` holding every name in `names`, and release them whatever it does.
     *
     * ⚠ Several names are taken in one order, sorted, so two runs that share names cannot each hold
     *   one the other is waiting for.
     */
    run<T>(names: readonly string[], work: () => Promise<T>): Promise<T>;
}
export declare function createKeyLocks(): KeyLocks;
