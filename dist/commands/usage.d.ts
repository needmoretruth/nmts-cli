export interface UsageOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Machine-readable output. For an agent this is the shape to parse; the table is for a person. */
    json?: boolean;
    write?: (line: string) => void;
}
export declare function usage(options?: UsageOptions): Promise<number>;
