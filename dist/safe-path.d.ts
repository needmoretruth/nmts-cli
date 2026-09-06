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
export declare function destinationFor(outDir: string, accountPath: string): string;
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
export declare function unwritableOn(name: string, platform: NodeJS.Platform): string | null;
/**
 * Refuse a name that this platform cannot hold, saying what to do about it.
 *
 * ⛔ A REFUSAL, NOT A RENAME. Renaming quietly would hand somebody a file under a name they did not
 *    choose and cannot predict, and the one thing worse than not getting a file is thinking you got
 *    it. The person can rename it in the drive, or name it themselves on the way out.
 */
export declare function refuseUnwritableName(name: string, platform?: NodeJS.Platform): void;
