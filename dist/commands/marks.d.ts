export interface MarkOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
/** Star one or more files: they show in the drive's favourites as well as in their own folder. */
export declare function star(paths: readonly string[], options?: MarkOptions): Promise<number>;
/** Take the star off. */
export declare function unstar(paths: readonly string[], options?: MarkOptions): Promise<number>;
/** Hold one or more files at the top of the folder they are in. */
export declare function pin(paths: readonly string[], options?: MarkOptions): Promise<number>;
/** Let them fall back into the ordinary order. */
export declare function unpin(paths: readonly string[], options?: MarkOptions): Promise<number>;
/**
 * Put one label on one or more files.
 *
 * ⚠ A LABEL EXISTS EXACTLY AS LONG AS SOME FILE WEARS IT. There is no registry to add it to and
 *   none to clean up: two devices inventing the same label converge on it instead of colliding,
 *   and the last `unlabel` is what makes it stop existing.
 */
export declare function label(name: string | undefined, paths: readonly string[], options?: MarkOptions): Promise<number>;
/** Take one label off one or more files. */
export declare function unlabel(name: string | undefined, paths: readonly string[], options?: MarkOptions): Promise<number>;
/**
 * `nmts label --rename <old> <new>` — one label's name, changed on every file that wears it.
 *
 * ⛔ IT IS A SWEEP, AND IT NAMES NO PATHS. A label has no registry to rename it in (see `label`
 *    above): it exists on the files, so renaming it means touching every file that wears it. That
 *    is why this is a different entry point rather than a switch on `label` — one takes the files
 *    it is given, and this one takes whatever the account holds.
 *
 * ⛔ RENAMING ONTO A LABEL THAT ALREADY EXISTS MERGES THE TWO. A file wearing both would otherwise
 *    end up wearing one label twice, which shows a doubled row and counts the file twice. The
 *    intent does that; it is written down here because it is the behaviour somebody has to be able
 *    to predict before typing this.
 */
export declare function labelRename(from: string | undefined, to: string | undefined, options?: MarkOptions): Promise<number>;
/**
 * `nmts unlabel <name> --all` — one label, taken off every file that wears it.
 *
 * ⛔ THIS IS WHAT MAKES A LABEL STOP EXISTING, and it is the whole reason the sweep is worth a
 *    flag: a label with no registry can only be removed by finding every file wearing it, and
 *    doing that by hand is how one file keeps a label nobody can see any more.
 */
export declare function unlabelAll(name: string | undefined, options?: MarkOptions): Promise<number>;
