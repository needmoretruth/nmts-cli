export interface KitOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where to put it: a directory, or the file name to write. Default: this directory. */
    out?: string | undefined;
    /** Replace a file that is already there. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function kit(options?: KitOptions): Promise<number>;
