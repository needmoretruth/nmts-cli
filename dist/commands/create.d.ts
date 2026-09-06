export interface CreateOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** A file to write the new account code into, instead of printing it. Never overwritten. */
    out?: string | undefined;
    /** The Terms of Service version a PERSON read and accepts for the new account. */
    acceptTerms?: string | undefined;
    /** The Privacy Policy version accepted in the same act. */
    acceptPrivacy?: string | undefined;
    /**
     * Link path only: print the address and stop, instead of waiting for a person to use it.
     *
     * ⚠ IT DOES NOTHING ON THE KEY PATH, because there is nothing to wait for there — the account
     *   exists by the time that path prints anything.
     */
    noWait?: boolean | undefined;
    write?: (line: string) => void;
}
export declare function create(options?: CreateOptions): Promise<number>;
