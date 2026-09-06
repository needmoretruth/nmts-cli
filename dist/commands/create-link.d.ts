export interface CreateLinkOptions {
    server: string;
    network: string;
    out?: string | undefined;
    json?: boolean;
    /** Print the address and stop, instead of waiting for somebody to use it. */
    noWait?: boolean | undefined;
    write?: ((line: string) => void) | undefined;
}
export declare function createThroughLink(options: CreateLinkOptions): Promise<number>;
