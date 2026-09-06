export interface LossesOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Machine-readable output. The list arm prints the server's own object, unchanged. */
    json?: boolean;
    write?: (line: string) => void;
    /** Ask the chain about ONE listed object now, instead of listing. */
    recheck?: string | undefined;
    /** Take ONE line off this account's own drive, instead of listing. */
    dismiss?: string | undefined;
}
export declare function losses(options?: LossesOptions): Promise<number>;
