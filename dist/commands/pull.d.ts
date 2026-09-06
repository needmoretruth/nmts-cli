export interface PullOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where the tree goes. Defaults to the working directory. */
    out?: string | undefined;
    /** Replace files that are already there. Without it they are skipped and counted. */
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function pull(target: string | undefined, options?: PullOptions): Promise<number>;
/**
 * Join a drive path onto a local directory, refusing anything that would leave it.
 *
 * ⛔ THE NAMES COME FROM THE SEALED LIST, which is written by whoever holds the account — including
 *    an account somebody else set up. A name with a separator in it, or one made of dots, would
 *    otherwise write outside the directory that was asked for, which is a file appearing somewhere
 *    nobody chose.
 */
/**
 * Where one drive path lands under `base`, or a refusal.
 *
 * ⚠ `platform` exists so the Windows branch can be exercised from any machine. Without it the
 *   ordering below is only ever checked by the Windows runner, and it was wrong there for one
 *   release.
 */
export declare function safeJoin(base: string, drivePath: string, platform?: NodeJS.Platform): string;
