import type { ParsedArgs } from "../args.ts";
export interface PublicCodeOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Publish it, so other accounts can send to it. */
    publish?: boolean;
    /** `--save [file]`: write this account's public code file (NCF-3 §5.7) — the default code's. */
    save?: boolean;
    /** `--save --as <n>`: the file for code number n instead, made on this machine alone. */
    as?: string | undefined;
    /** The file `--save` writes; by default `nmts-public-code-<code>.nmtscode` here. */
    file?: string | undefined;
    /** Replace that file if it exists. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
/** `nmts public-code [list|new|revoke]` and `nmts public-code --save [file]`, from the parsed command line. */
export declare function runPublicCode(args: ParsedArgs): Promise<number>;
export declare function publicCode(options?: PublicCodeOptions): Promise<number>;
