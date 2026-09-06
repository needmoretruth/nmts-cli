/** Setting this to anything stops the lookup and the notice, both. */
export declare const NO_CHECK_ENV_VAR = "NMTS_NO_UPDATE_CHECK";
/** Is the version check switched off here? */
export declare function checkingIsOff(env?: NodeJS.ProcessEnv): boolean;
/**
 * The address that names the newest release whatever it is called.
 *
 * It answers with a redirect to the tagged page, and the tag carries the version. That is one
 * request with an empty body — cheaper than the release listing, and it needs no credential.
 */
export declare const LATEST_RELEASE_URL = "https://github.com/needmoretruth/nmts-cli/releases/latest";
/** Is this string a version this file is willing to reason about? */
export declare function isVersion(value: string): boolean;
/**
 * The version a `releases/latest` redirect landed on, or null.
 *
 * ⛔ THE ADDRESS IS CHECKED, NOT JUST READ. It arrives from the network, and a redirect that
 *    pointed somewhere else entirely would otherwise decide what this tool calls the newest
 *    release. It has to be the tag page of this repository, over an encrypted connection, and the
 *    tag itself has to be a version.
 */
export declare function versionFromLocation(location: string): string | null;
/**
 * -1, 0 or 1 — or null when either side is not a version this can compare.
 *
 * ⚠ Null is not "equal". A caller that treats it as equal says nothing; one that treats it as
 *   "newer" nags forever about a release that does not exist. Both callers here read it as
 *   "no answer".
 */
export declare function compareVersions(left: string, right: string): number | null;
/** Is `candidate` a release later than the one running? Unanswerable counts as no. */
export declare function isNewer(candidate: string, running: string): boolean;
/** The page a person can read about one release on. */
export declare function releasePageUrl(version: string): string | null;
/**
 * Where one release's package is.
 *
 * ⛔ THE TAGGED ADDRESS, NEVER "LATEST". This is handed to another program to install, and
 *    "latest" would install whatever is newest at the moment that program runs — which is not
 *    necessarily the version this tool just named on the screen. Naming the release means what
 *    was reported and what gets installed are the same thing.
 */
export declare function packageUrl(version: string): string | null;
/**
 * The exact command that installs one release, as an argument list.
 *
 * ⛔ A LIST AND NOT A STRING, because it is both printed and run. A string would have to be split
 *    again to be run, and splitting a string is where a shell gets involved — the one thing a
 *    command built partly from a value off the network must not touch. `packageUrl` has already
 *    refused anything that is not three numbers, so nothing here can carry a space, a quote or a
 *    semicolon, and it never needs to.
 */
export declare function installCommand(version: string): readonly string[] | null;
/** The same command as one line, for printing. */
export declare function installCommandLine(version: string): string | null;
/**
 * The one line printed when a newer release exists.
 *
 * ⛔ IT SAYS WHAT IS PUBLISHED AND WHAT IS RUNNING, AND NOTHING ABOUT WHETHER TO UPGRADE. What is
 *    in a release is not known here, and a line that called it important, recommended or a fix
 *    would be inventing a reason to act.
 */
export declare function newerVersionLine(latest: string, running: string, binary: string): string;
