export interface ShareOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** `--yes`: the per-attempt answer `share` needs in normal mode (see `share`). */
    yes?: boolean;
    write?: (line: string) => void;
}
export declare function out(options: ShareOptions): (line: string) => void;
/** `nmts share <path> <address>` — hand one file to one account. */
export declare function share(target: string | undefined, typedAddress: string | undefined, options?: ShareOptions): Promise<number>;
/** `nmts shares` — what was shared with this account, and what it shared. */
export declare function shares(options?: ShareOptions): Promise<number>;
export declare function unshare(id: string | undefined, options?: ShareOptions): Promise<number>;
