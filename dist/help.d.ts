export declare function helpText(version: string): string;
/**
 * `nmts help <command>`: the document for one command, from `docs/commands/`, or the list of
 * documents when the name matches none.
 *
 * ⚠ The directory is read only here, so `--help` itself pays nothing for it (`check:cli-startup`).
 *   Each document names the commands it covers on its `Commands:` line; that line is the index.
 */
export declare function helpFor(topic: string): Promise<{
    text: string;
    found: boolean;
}>;
/**
 * What `--help`, a bare run, `help`, and `help <command>` print, and the exit code.
 * ⛔ `support` has help of its own: it is READ before deciding, not scanned for an option name.
 */
export declare function printHelp(args: {
    command: string | null;
    operands: readonly string[];
}, write: (text: string) => void): Promise<number>;
