export interface LsOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Machine-readable output. For an agent this is the shape to parse; the table is for a person. */
    json?: boolean;
    /** Include entries that are in the trash. */
    all?: boolean;
    /**
     * Keep only files whose name contains this text, case-insensitively.
     *
     * Taken as plain text rather than a parsed key so this command owns the refusal for a query that
     * cannot mean anything — see `list-view-find.ts` for what a query does and does not match.
     */
    find?: string | undefined;
    /** `name`, `size` or `date`. Absent = the path order this command has always printed. */
    sort?: string | undefined;
    /** Reverse whichever order is in effect. */
    desc?: boolean;
    write?: (line: string) => void;
    /** The instant the trash countdown is measured against. Passed in so one listing means one moment. */
    now?: number;
}
export declare function ls(options?: LsOptions): Promise<number>;
