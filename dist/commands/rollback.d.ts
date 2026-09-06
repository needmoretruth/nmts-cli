export interface RollbackOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** Go ahead and write it back. Without this the run reports and changes nothing. */
    yes?: boolean;
    write?: (line: string) => void;
}
export declare function rollback(options?: RollbackOptions): Promise<number>;
