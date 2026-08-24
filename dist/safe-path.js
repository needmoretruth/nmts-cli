// Where a name that came from somewhere else is allowed to land on this disk.
//
// ⛔ IT LIVES ON ITS OWN BECAUSE MORE THAN ONE CALLER NEEDS IT. It began inside the agent server,
//    which is where a model's chosen path must be contained; the same containment is needed the
//    moment anything else writes a file under a name this program did not choose — a share opened
//    with the sender's name, for instance. Two copies of a containment check is one copy that goes
//    stale, and the stale one is the one that lets something out.
import { basename, resolve, sep } from "node:path";
import { NmtsError } from "./errors.js";
/**
 * Resolve where one fetched file goes, refusing anything that leaves the chosen directory.
 *
 * ⛔ It takes only the LAST segment of the account path. A file called `../../etc/passwd` in
 *    somebody's drive is a legal name for a file; it must not become a path on this disk. The
 *    containment check that follows is belt as well as braces — `basename` already strips the
 *    separators, and the check catches the day some platform disagrees about what a separator is.
 *
 * ⛔ IT IS ALSO WHAT KEEPS `-` FROM MEANING stdout ON THIS SERVER. `get` reads an `out` of exactly
 *    `-` as "hand the file to whatever is reading stdout", and here that reader is the client's
 *    protocol connection. Every answer this function gives has been through `resolve`, so it is
 *    always an absolute path and never the bare `-`: a model asking for a file named `-` gets a
 *    file named `-` inside the chosen directory, and the streaming branch is unreachable from
 *    this server rather than merely unused by it.
 */
export function destinationFor(outDir, accountPath) {
    const name = basename(accountPath);
    if (name === "" || name === "." || name === "..") {
        throw new NmtsError(`"${accountPath}" does not name a file that can be written here.`);
    }
    const root = resolve(outDir);
    const full = resolve(root, name);
    if (full !== root && !full.startsWith(root + sep)) {
        throw new NmtsError(`"${accountPath}" would be written outside ${root}.`);
    }
    return full;
}
