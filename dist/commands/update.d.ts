import { lookupLatest } from "../update-check.ts";
export interface UpdateOptions {
    json?: boolean;
    /** Say what it would install, and stop. */
    dryRun?: boolean;
    write?: (line: string) => void;
    /** Injected in tests, so the whole command can run without a host. */
    lookup?: typeof lookupLatest;
    /** Injected in tests. What is running now. */
    running?: string;
    /**
     * The file this module was loaded from — the basis for "was this copy installed".
     *
     * ⚠ Injected rather than read straight from `import.meta` so both answers can be tested on one
     *   machine. Nothing on a command line reaches it.
     */
    moduleFile?: string;
    /** Injected in tests. Runs the installer and reports how it went. */
    install?: (command: readonly string[], json: boolean) => InstallOutcome;
}
/** What running the installer produced. */
export interface InstallOutcome {
    code: number;
    /** What it said, when its output was captured rather than passed through. */
    output?: string;
    /** Why it could not be started at all. */
    unstartable?: string;
}
/**
 * Was this copy put here by the installer that would replace it?
 *
 * The test is the one thing that is actually true of every such copy and of nothing else: it
 * lives in a directory named for the package, inside a `node_modules`.
 *
 * ⛔ BOTH SEPARATORS, AND THAT IS NOT DEFENSIVENESS. Windows accepts either, and Node hands out
 *    either: a path that came through a file URL arrives as `D:/a/…` while `import.meta.filename`
 *    gives `D:\a\…`. Splitting on the platform's own separator found nothing in the first shape,
 *    so an installed copy on Windows was told it was not installed and `update` refused to run —
 *    green on Linux and macOS, red only on the platform this repository tests last.
 */
export declare function installedAsPackage(moduleFile: string): boolean;
export declare function update(options?: UpdateOptions): Promise<number>;
