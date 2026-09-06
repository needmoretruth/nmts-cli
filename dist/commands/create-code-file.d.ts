import { NmtsError } from "../errors.ts";
/**
 * Where the code goes, or `null` for the screen.
 *
 * ⛔ `-` IS REFUSED, WHICH IS THE OPPOSITE OF WHAT IT MEANS EVERYWHERE ELSE IN THIS TOOL. In
 *    `get` and `listfile` it means "hand the bytes to whatever is reading stdout", and that is
 *    right for a file somebody already has. Here it would mean putting the only copy of an
 *    NMTS key into the same stream a program is parsing — which is the one place this command
 *    exists to keep it out of.
 */
export declare function codeFileTarget(out: string | undefined): string | null;
/**
 * Write the code where the caller pointed, readable by nobody else.
 *
 * ⚠ `wx` FAILS IF THE NAME APPEARED SINCE THE CHECK ABOVE, which is the point of using it rather
 *   than trusting that check: between the two, something else may have written there.
 *
 * ⚠ ON WINDOWS THE MODE IS IGNORED and the file inherits the folder's permissions — the same
 *   limit `credentials.ts` documents, and claiming otherwise would be claiming a guarantee the
 *   platform does not give.
 */
export declare function writeCodeFile(path: string, code: string): void;
/** `--json` without `--out`: there is nowhere for the code to go that is not the output. */
export declare function jsonNeedsAFile(): NmtsError;
