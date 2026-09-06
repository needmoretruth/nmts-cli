import { type ByteDestination } from "../stdout.ts";
export interface GetOptions {
    server?: string | undefined;
    network?: string | undefined;
    /**
     * Where to write it. Defaults to the file's own name, in the working directory.
     *
     * `-` means stdout: nothing is written and the bytes go to whatever is reading this program.
     */
    out?: string | undefined;
    /** Overwrite an existing file. Off by default, and saying so is the point. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
    /** Where the file's own bytes go when `out` is `-`. Injectable so a test can read them. */
    stdout?: ByteDestination;
}
export declare function get(target: string | undefined, options?: GetOptions): Promise<number>;
