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
    refuseUnwritableName(name);
    const root = resolve(outDir);
    const full = resolve(root, name);
    if (full !== root && !full.startsWith(root + sep)) {
        throw new NmtsError(`"${accountPath}" would be written outside ${root}.`);
    }
    return full;
}
/**
 * Windows keeps a handful of names for devices, and writing to one succeeds while storing nothing.
 *
 * ⛔ THE FAILURE IS SILENT, WHICH IS WHY IT IS WORTH CODE. A drive holding a file called `NUL`
 *    pulled onto Windows opens the null device: every byte is accepted, nothing is kept, and the
 *    tool says it wrote the file. A name containing a colon is worse than silent — it writes an
 *    alternate data stream on a DIFFERENT file, where nothing lists it. And a name ending in a dot
 *    or a space is not the name it looks like: Win32 strips those before opening, so two files can
 *    quietly become one.
 *
 * ⚠ The check is per PLATFORM, not universal. `NUL` is an ordinary, legal file name on Linux and
 *   macOS, and refusing it there would take a file away from somebody who can hold it perfectly
 *   well. The platform is a parameter so a test on any machine can ask the Windows question.
 *
 * Returns the reason it cannot be written, or null when it can.
 */
export function unwritableOn(name, platform) {
    if (platform !== "win32")
        return null;
    // ⚠ THE EXTENSION DOES NOT SAVE IT. `NUL.txt` and `AUX.iliary` open the device just as `NUL`
    //   does — Windows reads the part before the first dot. Judging the whole name instead would
    //   let every one of these through.
    const stem = (name.split(".")[0] ?? "").trim();
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)) {
        return `Windows keeps "${stem}" for a device, so writing this name would store nothing`;
    }
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
        return `Windows does not allow < > : " | ? * in a file name, and a colon writes a hidden stream instead`;
    }
    if (/[. ]$/.test(name)) {
        return "Windows drops a dot or a space at the end of a name, so this file would not keep its name";
    }
    return null;
}
/**
 * Refuse a name that this platform cannot hold, saying what to do about it.
 *
 * ⛔ A REFUSAL, NOT A RENAME. Renaming quietly would hand somebody a file under a name they did not
 *    choose and cannot predict, and the one thing worse than not getting a file is thinking you got
 *    it. The person can rename it in the drive, or name it themselves on the way out.
 */
export function refuseUnwritableName(name, platform = process.platform) {
    const why = unwritableOn(name, platform);
    if (why === null)
        return;
    throw new NmtsError(`"${name}" cannot be written on this system: ${why}.`, {
        exitCode: 4,
        nextStep: "Nothing was written. Rename it in the drive, or fetch this one file on its own and choose " +
            "the name it lands under.",
    });
}
