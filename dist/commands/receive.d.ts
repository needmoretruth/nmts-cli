import { type ByteDestination } from "../stdout.ts";
export interface ReceiveOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where to write it. Defaults to the name the sender gave it, in the working directory. */
    out?: string | undefined;
    /**
     * A DIRECTORY to write into, keeping the sender's name — for callers that must not let a name
     * from somewhere else choose a path.
     *
     * ⛔ IT IS NOT `out` WITH A SLASH. `out` is a full path the caller picked; this one says "the
     *    name is theirs, the place is mine", and the name is reduced to its last segment and checked
     *    against this directory before anything opens. A sender who calls their file
     *    `../../.ssh/authorized_keys` has picked a legal name for a file and must not thereby pick a
     *    path on somebody else's disk. Ignored when `out` is given.
     */
    intoDir?: string | undefined;
    force?: boolean;
    /** Where the bytes go when `--out -` was given. Injected so a test can read them. */
    stdout?: ByteDestination;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function receive(id: string | undefined, options?: ReceiveOptions): Promise<number>;
