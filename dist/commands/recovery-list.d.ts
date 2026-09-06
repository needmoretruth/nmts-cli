export interface RecoveryListOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where to put it: a directory, or the file name to write. Default: this directory. */
    out?: string | undefined;
    /** Replace a file that is already there. Off by default, and saying so is the point. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function recoveryList(options?: RecoveryListOptions): Promise<number>;
