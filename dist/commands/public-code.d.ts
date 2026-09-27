export interface PublicCodeOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Publish it, so other accounts can send to it. Permanent. */
    publish?: boolean;
    /** `--save [file]`: write this account's public code file (NCF-3 §5.7). Asks the server nothing. */
    save?: boolean;
    /** The file `--save` writes; by default `nmts-public-code-<code>.nmtscode` here. */
    file?: string | undefined;
    /** Replace that file if it exists. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function publicCode(options?: PublicCodeOptions): Promise<number>;
