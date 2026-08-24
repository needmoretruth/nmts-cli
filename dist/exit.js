// How this program ends: the code it leaves behind, and the one failure that must not become one.
//
// ⛔ SPLIT OUT OF `main.ts` RATHER THAN INVENTED. Both of these were written there and are
//    unchanged; they moved because that file passed the length gate the day five commands landed,
//    and the rule in this repository is that a file gets divided when it is being worked on. What
//    belongs together here is "the shape of the ending" — everything above it in `main.ts` decides
//    WHAT to do, and these two decide how the process stops saying so.
import { realpathSync } from "node:fs";
import { NmtsError, UNKNOWN_FAILURE_EXIT } from "./errors.js";
/** The exit code a failure asks for, or the generic one. */
export function exitCodeFor(error) {
    if (error instanceof NmtsError)
        return error.exitCode;
    return UNKNOWN_FAILURE_EXIT;
}
/**
 * Stop a closed pipe from becoming a crash.
 *
 * ⛔ `nmts ls | head` IS AN ORDINARY THING TO DO, and without this it prints a ten-line stack
 *    trace instead of the answer. `head` closes the pipe once it has its lines; the next write
 *    raises EPIPE, and Node turns an unhandled stream error into a fatal one. Every shell tool is
 *    expected to end quietly there — that is what SIGPIPE does for programs that do not intercept
 *    it — and an agent piping this into anything would otherwise read a crash and conclude the
 *    tool is broken.
 *
 * ⚠ ONLY EPIPE. A write that fails for any other reason is still a real failure and still throws;
 *   swallowing all stream errors would hide a full disk behind silence.
 */
export function endQuietlyOnClosedPipe() {
    for (const stream of [process.stdout, process.stderr]) {
        stream.on("error", (error) => {
            if (error.code === "EPIPE") {
                process.exitCode = 0;
                return;
            }
            throw error;
        });
    }
}
/**
 * Is the module at `moduleFilename` the program, or is something importing it?
 *
 * ⛔ THE FILENAME IS PASSED IN AND NOT READ HERE. `import.meta.filename` inside this module
 *    would name THIS file, which is never the program; the caller's own is the question.
 *
 * ⛔ THE COMPARISON IS BETWEEN REAL PATHS, AND THAT IS THE WHOLE POINT. `npm install -g` does not
 *    copy the command onto your PATH — it puts a SYMLINK there, pointing at `dist/main.js` inside
 *    the installed package. Node then loads the module by its real
 *    path, so the module's own name is `.../dist/main.js` while `process.argv[1]` is
 *    `.../bin/nmts`. Comparing those two directly is never true for an installed command: `nmts --version` printed NOTHING and exited 0, and
 *    so did every other command. The whole tool did nothing at all, silently, and only when
 *    installed — which is the one way a person who is not us runs it.
 *
 * ⚠ `realpathSync` THROWS on a path that is not there. `process.argv[1]` normally exists, but a
 *   caller is free to hand Node something else, and a crash before the first line of output would
 *   be a worse answer than not running. Not resolving is treated as "not the program", which is
 *   the same answer this was giving before symlinks were considered at all.
 */
export function invokedDirectly(moduleFilename) {
    const invokedAs = process.argv[1];
    if (invokedAs === undefined)
        return false;
    if (invokedAs === moduleFilename)
        return true;
    try {
        return realpathSync(invokedAs) === moduleFilename;
    }
    catch {
        return false;
    }
}
