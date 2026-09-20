import { NmtsError } from "../errors.ts";
/**
 * What went wrong, in a word a program can branch on.
 *
 * ⚠ FIVE, AND THEY ARE ABOUT THE LIST. A server refusal arrives as `ServerError` with the server's
 *   own code, and a lost compare-and-swap that never settles arrives as a plain `NmtsError`;
 *   neither is a decision this file made.
 */
export type DriveEditCode = 
/** No entry at that path — or a path that names two, which is the same "which one?" */
"NOT_FOUND"
/** Something else in that folder already answers to that name. */
 | "NAME_TAKEN"
/** The name itself cannot be used: empty, `.`, `..`, or a path pretending to be a name. */
 | "BAD_NAME"
/** A restore was asked for something that is not in the trash, or not in it on its own account. */
 | "NOT_IN_TRASH"
/** A folder was asked to move inside itself. */
 | "INTO_ITSELF";
/** A refusal about the list, with the sentence a person reads and the word a program reads. */
export declare class DriveEditError extends NmtsError {
    readonly code: DriveEditCode;
    constructor(code: DriveEditCode, message: string, options?: {
        exitCode?: number;
        nextStep?: string | null;
    });
}
/**
 * Run a path lookup, and label whatever it refused as `NOT_FOUND`.
 *
 * ⛔ THE SENTENCE, THE EXIT CODE AND THE NEXT STEP ARE CARRIED THROUGH UNTOUCHED. `drive-paths.ts`
 *    words three different failures — nothing there, it is in the trash, it names two things — and
 *    each of them is better than anything this file could say about them. What is added is the one
 *    thing it cannot carry: a code, so a program does not have to read English to know a path did
 *    not resolve.
 */
export declare function resolving<T>(body: () => T): T;
/**
 * A new name is a name and not a path.
 *
 * ⛔ REFUSED RATHER THAN SPLIT. A name with a `/` in it is somebody asking for a move while typing
 *    a rename, and quietly doing the move would put the file somewhere they did not look.
 */
export declare function requireNewName(name: string): string;
