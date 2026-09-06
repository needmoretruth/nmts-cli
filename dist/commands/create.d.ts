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
    write?: (line: string) => void;
}
export declare function create(options?: CreateOptions): Promise<number>;
