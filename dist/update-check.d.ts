export { checkingIsOff, NO_CHECK_ENV_VAR } from "./update-source.ts";
/** How long an answer is kept before another is asked for. */
export declare const CHECK_EVERY_MS: number;
/** What the last attempt found, or why it found nothing. */
export interface UpdateCheck {
    /** When the last attempt happened — whether or not it answered. */
    checkedAt: string;
    /** The newest version the last attempt that DID answer found. */
    latest?: string;
    /** Why the last attempt did not answer. Absent when it did. */
    failed?: string;
}
export declare function checkPath(): string;
/** What is on disk, or null when there is nothing readable there. */
export declare function readCheck(): UpdateCheck | null;
/** Write the attempt down. Failing to write is itself ignored: there is nothing to fall back to. */
export declare function writeCheck(record: UpdateCheck): void;
/** Is it time to ask again? Never having asked counts as due. */
export declare function dueForCheck(record: UpdateCheck | null, nowMs: number): boolean;
/** What one lookup produced. */
export type Lookup = {
    version: string;
} | {
    failed: string;
};
/**
 * Ask which release is newest.
 *
 * ⛔ THE REDIRECT IS THE ANSWER, so it is not followed. `releases/latest` replies with the address
 *    of the tagged page and an empty body; following it would download a page this has no use for.
 */
export declare function lookupLatest(url?: string): Promise<Lookup>;
export interface NoteOptions {
    /** The version running now. */
    running: string;
    /** The clock. Injected so a test does not depend on today. */
    now?: Date;
    /** Where the notice goes. Defaults to stderr. */
    say?: (line: string) => void;
    /** The lookup. Injected so a test does not depend on a host. */
    lookup?: () => Promise<Lookup>;
    env?: NodeJS.ProcessEnv;
}
/**
 * Print the notice this run has earned, then refresh the file for the next one.
 *
 * The order is deliberate: whatever is already known is said first, so a slow or unreachable host
 * cannot delay it, and the run that pays for the lookup is not the run that reads its result.
 */
export declare function noteUpdate(options: NoteOptions): Promise<void>;
