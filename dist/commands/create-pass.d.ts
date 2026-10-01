export interface CreatePassOptions {
    server: string;
    network: string;
    /** The pass, as read from `NMTS_AGENT_PASS`. Never from argv. */
    pass: string;
    json?: boolean;
    /** Typed by a PERSON only, as on every create path. A pass usually carries their acceptance. */
    acceptTerms?: string | undefined;
    acceptPrivacy?: string | undefined;
    write?: ((line: string) => void) | undefined;
}
export declare function createWithPass(options: CreatePassOptions): Promise<number>;
