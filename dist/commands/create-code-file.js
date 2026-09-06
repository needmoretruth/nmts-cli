// Where a new NMTS key goes when it is not printed, and the rules around that file.
//
// ⛔ IT LEFT `create.ts` BECAUSE THERE ARE TWO PATHS ONTO IT NOW (2026-09-05). `create` makes an
//    account either with a verified API key or through a registration address a person opens, and
//    both make the same code and owe it the same treatment: written before anything is asked of
//    the server, never overwritten, never sent to stdout. A second copy of these three rules is a
//    second place for one of them to be relaxed.
//
// ⛔ AND THE FILE IS WRITTEN BEFORE THE ACCOUNT IS ASKED FOR. A full disk, a bad path or a name
//    already taken must fail while there is still nothing to lose; discovering it AFTER the server
//    has created the account would mean an account exists whose only key we are about to drop.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { NmtsError } from "../errors.js";
import { STDOUT_TARGET } from "../stdout.js";
/**
 * Where the code goes, or `null` for the screen.
 *
 * ⛔ `-` IS REFUSED, WHICH IS THE OPPOSITE OF WHAT IT MEANS EVERYWHERE ELSE IN THIS TOOL. In
 *    `get` and `listfile` it means "hand the bytes to whatever is reading stdout", and that is
 *    right for a file somebody already has. Here it would mean putting the only copy of an
 *    NMTS key into the same stream a program is parsing — which is the one place this command
 *    exists to keep it out of.
 */
export function codeFileTarget(out) {
    if (out === undefined || out === "")
        return null;
    if (out === STDOUT_TARGET) {
        throw new NmtsError("The new NMTS key will not be sent to stdout.", {
            exitCode: 2,
            nextStep: `Nothing was created. stdout is what a program reads and a log keeps, and this is the ` +
                `only copy of your NMTS key. Name a file — \`--out ./account-code.txt\` — or leave --out off ` +
                `and read it off the screen.`,
        });
    }
    const path = isAbsolute(out) ? out : resolve(process.cwd(), out);
    let existing = null;
    try {
        existing = statSync(path);
    }
    catch {
        // Not there is exactly what this wants.
    }
    if (existing !== null) {
        // ⛔ NO `--force` HERE, DELIBERATELY. Everywhere else in this tool --force replaces a file
        //    that can be fetched again. The file this would replace may be the only copy of ANOTHER
        //    account's code, and overwriting it destroys that account with no way back.
        throw new NmtsError(`${path} is already there.`, {
            exitCode: 4,
            nextStep: existing.isDirectory()
                ? `--out names the FILE the NMTS key goes into, not a directory.`
                : `Nothing was created. That file is not replaced, whatever --force says: it may hold ` +
                    `the only copy of another account's NMTS key. Name one that does not exist.`,
        });
    }
    return path;
}
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
export function writeCodeFile(path, code) {
    const dir = resolve(path, "..");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        writeFileSync(path, `${code}\n`, { mode: 0o600, flag: "wx" });
    }
    catch (error) {
        // ⛔ THE CAUSE IS NAMED BUT THE CODE IS NOT. `writeFileSync`'s errno line carries the path and
        //    never the contents, so it is safe to pass on; the code itself appears in no message here.
        throw new NmtsError(`The NMTS key could not be written to ${path}.`, {
            exitCode: 1,
            nextStep: `Nothing was created — the file is written before the account is asked for, so that a ` +
                `failure here costs nothing. Cause: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
}
/** `--json` without `--out`: there is nowhere for the code to go that is not the output. */
export function jsonNeedsAFile() {
    return new NmtsError("--json needs --out, because the NMTS key will not go into the output.", {
        exitCode: 2,
        nextStep: `Nothing was created. Machine-readable output is read by a program and kept by a log, and ` +
            `your NMTS key is the only key this account will ever have. \`--out ./account-code.txt\` writes ` +
            `it to a file only you can read; the JSON then names that file. Without --json the NMTS key is ` +
            `printed on the screen for a person to keep.`,
    });
}
