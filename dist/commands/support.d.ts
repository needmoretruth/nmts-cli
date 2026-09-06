export interface SupportOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** What a report is about, and optionally which part of it. */
    category?: string | undefined;
    sub?: string | undefined;
    /** The message itself, or the file holding it. Neither means: read the standard input. */
    message?: string | undefined;
    messageFile?: string | undefined;
    /** `--attach-log`: absent means none, empty means the default count, otherwise a number. */
    attachLog?: string | undefined;
    /** Values the caller says must not travel, whatever the rules make of them. */
    omit?: readonly string[] | undefined;
    /** Send without being asked. */
    yes?: boolean;
    /** Where a message with no `--message` comes from. Injected so a test needs no pipe. */
    readInput?: () => Promise<string>;
    /** How the person is asked. Injected for the same reason. */
    askPerson?: (question: string) => Promise<string>;
}
/** `nmts support <action> [operands]`. */
export declare function support(action: string | undefined, operands: readonly string[], options?: SupportOptions): Promise<number>;
