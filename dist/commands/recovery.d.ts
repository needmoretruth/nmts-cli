export interface RecoveryOptions {
    /** Where to put it: a directory, or the file name to write. Default: the working directory. */
    out?: string | undefined;
    /** Replace a file that is already there. Off by default, and saying so is the point. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
    /**
     * Where the program is published.
     *
     * ⚠ Overridable so a test can drive the whole download against a server on this machine. There
     *   is no command-line option for it: this is not somewhere a person should be talked into
     *   pointing an executable download.
     */
    source?: string | undefined;
    /**
     * What machine to fetch for.
     *
     * ⚠ Overridable so the refusal a machine with no published executable gets can be tested on a
     *   machine that has one. Defaults to what this process is running on.
     */
    platform?: string;
    arch?: string;
}
export declare function recovery(options?: RecoveryOptions): Promise<number>;
