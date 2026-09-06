export interface RebuildOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** Write the rebuilt list. Without this the run reports and writes nothing. */
    yes?: boolean;
    /** Rebuild even though this machine has seen a file list for this account before. */
    force?: boolean;
    write?: (line: string) => void;
}
export declare function rebuild(options?: RebuildOptions): Promise<number>;
