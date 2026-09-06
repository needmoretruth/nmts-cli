export interface ListFileOptions {
    /**
     * Where to write it: a directory, a file name, or `-` for standard output. Default: this
     * directory, under the name the file describes itself with.
     */
    out?: string | undefined;
    /** Replace a file that is already there. */
    force?: boolean;
    write?: (line: string) => void;
    /** Where the document goes when `--out -` asked for it. */
    writeDocument?: (text: string) => void;
}
export declare function listfile(options?: ListFileOptions): Promise<number>;
