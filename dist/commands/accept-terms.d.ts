export interface AcceptTermsOptions {
    server?: string | undefined;
    write?: ((line: string) => void) | undefined;
    /** Injected in tests: answers the two typed lines, in order. */
    readLine?: ((question: string) => Promise<string>) | undefined;
    /** `--accept-terms <version>`: the version the person said they accept, relayed by an agent. */
    terms?: string | undefined;
    /** `--accept-privacy <version>`: the version the person said they have read. */
    privacy?: string | undefined;
}
export declare function acceptTerms(options?: AcceptTermsOptions): Promise<number>;
