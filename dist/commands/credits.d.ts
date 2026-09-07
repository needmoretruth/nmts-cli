export interface CreditsOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** `--to`: which account receives, base64url, as `nmts whoami` prints it for that account. */
    to?: string | undefined;
    write?: (line: string) => void;
}
export declare function credits(action: string | undefined, amount: string | undefined, options?: CreditsOptions): Promise<number>;
