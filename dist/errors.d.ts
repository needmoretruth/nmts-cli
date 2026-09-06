/** A failure this tool understood, with an exit code and something the caller can do. */
export declare class NmtsError extends Error {
    readonly exitCode: number;
    /** One line naming the next action, or null when there is nothing useful to suggest. */
    readonly nextStep: string | null;
    constructor(message: string, options?: {
        exitCode?: number;
        nextStep?: string | null;
    });
}
/** Nothing is signed in on this machine and no code was supplied. */
export declare class NotLoggedInError extends NmtsError {
    constructor(binary: string, envVar: string);
}
/** The command exists but is not built yet. Said plainly rather than failing as if it broke. */
export declare class NotBuiltYetError extends NmtsError {
    constructor(what: string);
}
/** Render a failure for a terminal an agent is reading. */
export declare function renderError(error: unknown, binary: string): string;
/** Exit code for an unknown failure, kept distinct from the ones above. */
export declare const UNKNOWN_FAILURE_EXIT = 1;
