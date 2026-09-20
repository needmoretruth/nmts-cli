// What the drive's own edits refuse with: a word a program branches on, and the one rule that
// decides whether a new name is a name at all.
//
// ⛔ AND EVERY REFUSAL THIS FILE MAKES CARRIES A CODE. A terminal reads the sentence; a program
//    reads `error.code` and branches on it. That is why `DriveEditError` EXTENDS the tool's own
//    error rather than replacing it: the exit code and the next step are still there, `renderError`
//    prints exactly what it printed before, and `error instanceof NmtsError` is still true.
//
// ⚠ THE ARGUMENT-SHAPE REFUSALS ARE NOT HERE. "`nmts rename` needs what to rename" is about a
//   command line, and a library caller has no command line to be told about. What IS here is every
//   refusal about the LIST, because that one is the same question whoever asked it.
import { NmtsError } from "../errors.js";
/** A refusal about the list, with the sentence a person reads and the word a program reads. */
export class DriveEditError extends NmtsError {
    code;
    constructor(code, message, options = {}) {
        super(message, options);
        this.name = "DriveEditError";
        this.code = code;
    }
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
export function resolving(body) {
    try {
        return body();
    }
    catch (error) {
        if (error instanceof NmtsError && !(error instanceof DriveEditError)) {
            throw new DriveEditError("NOT_FOUND", error.message, {
                exitCode: error.exitCode,
                nextStep: error.nextStep,
            });
        }
        throw error;
    }
}
/**
 * A new name is a name and not a path.
 *
 * ⛔ REFUSED RATHER THAN SPLIT. A name with a `/` in it is somebody asking for a move while typing
 *    a rename, and quietly doing the move would put the file somewhere they did not look.
 */
export function requireNewName(name) {
    if (name.trim() === "") {
        throw new DriveEditError("BAD_NAME", "A name cannot be empty.", {
            exitCode: 2,
            nextStep: "Nothing was renamed.",
        });
    }
    if (name.includes("/")) {
        throw new DriveEditError("BAD_NAME", `A name cannot contain "/" — that is what makes it a path.`, {
            exitCode: 2,
            nextStep: `To move it, use \`nmts mv\`. Nothing was renamed.`,
        });
    }
    return name;
}
