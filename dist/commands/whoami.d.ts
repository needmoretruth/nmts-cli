export interface WhoamiOptions {
    server?: string | undefined;
    network?: string | undefined;
    write?: (line: string) => void;
    /** Print the NMTS key itself. A person's act — see the header. */
    reveal?: boolean;
    /** With `reveal`: print the key as its 15-word recovery phrase instead. */
    phrase?: boolean;
    /** The phrase's word list: `en` (default) or `ko`. */
    lang?: string | undefined;
    /** Machine-readable output. Only `--reveal` has one; the listing is for a person. */
    json?: boolean;
}
export declare function whoami(options?: WhoamiOptions): Promise<number>;
