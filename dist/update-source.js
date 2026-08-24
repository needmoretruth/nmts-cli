// Where a newer `nmts` comes from, and what "newer" means.
//
// ⛔ THE RELEASES OF THIS TOOL'S OWN REPOSITORY, NOT A PACKAGE REGISTRY. That is where this tool
//    is installed from today, so it is where "newest" is decided. Asking a registry it is not
//    published to would answer a different question and answer it confidently — the worst shape a
//    version check can have. If it is published to one as well, this file is where the two
//    answers would have to be reconciled, and that will be a decision rather than a default.
//
// ⛔ NOTHING HERE READS A FILE OR THE NETWORK. The one hop across the network and the record it
//    writes are in `update-check.ts`. What is here is what an answer MEANS — the shape it has to
//    have, how two versions compare, the exact command that installs one, and whether any of it is
//    switched on — so all of it is testable without a server.
//
// ⛔ AND THAT IS ALSO WHY THE SWITCH IS HERE. The help text has to name it, and the help text is
//    what `nmts --help` prints: putting the name in the module that also opens files would make
//    every run of the cheapest command load the file machinery to print one line. `check:cli-startup`
//    measures exactly that, and it is how this was noticed.
//
// ⛔ NOTHING HERE PARSES A VERSION LOOSELY. A string that is not three numbers is not a version,
//    and the answer to "is that one newer" is then "this cannot tell", never "yes". The direction
//    matters: the failure of a loose parse is a tool that nags about an upgrade that does not
//    exist, or worse, hands an unchecked string to a command line.
import { SOURCE_URL } from "./product.js";
/** Setting this to anything stops the lookup and the notice, both. */
export const NO_CHECK_ENV_VAR = "NMTS_NO_UPDATE_CHECK";
/** Is the version check switched off here? */
export function checkingIsOff(env = process.env) {
    return (env[NO_CHECK_ENV_VAR] ?? "").length > 0;
}
/**
 * The address that names the newest release whatever it is called.
 *
 * It answers with a redirect to the tagged page, and the tag carries the version. That is one
 * request with an empty body — cheaper than the release listing, and it needs no credential.
 */
export const LATEST_RELEASE_URL = `${SOURCE_URL}/releases/latest`;
/** What that redirect must point at. Anything else is not an answer to the question asked. */
const TAG_PREFIX = `${SOURCE_URL}/releases/tag/`;
/**
 * A version, exactly.
 *
 * ⛔ THREE NUMBERS AND NOTHING ELSE. Releases of this tool are tagged `v1.2.3`; a tag with a
 *    suffix is not a release of it, and treating one as a version would put whatever it contains
 *    into a URL and then onto a command line.
 */
const VERSION_SHAPE = /^(\d+)\.(\d+)\.(\d+)$/;
/** The published file that carries a whole release, under a name that does not change. */
const PACKAGE_ASSET = "nmts.tgz";
/** Is this string a version this file is willing to reason about? */
export function isVersion(value) {
    return VERSION_SHAPE.test(value);
}
/**
 * The version a `releases/latest` redirect landed on, or null.
 *
 * ⛔ THE ADDRESS IS CHECKED, NOT JUST READ. It arrives from the network, and a redirect that
 *    pointed somewhere else entirely would otherwise decide what this tool calls the newest
 *    release. It has to be the tag page of this repository, over an encrypted connection, and the
 *    tag itself has to be a version.
 */
export function versionFromLocation(location) {
    let resolved;
    try {
        resolved = new URL(location, LATEST_RELEASE_URL).toString();
    }
    catch {
        return null;
    }
    if (!resolved.startsWith(TAG_PREFIX))
        return null;
    const tag = decodeURIComponent(resolved.slice(TAG_PREFIX.length));
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    return isVersion(version) ? version : null;
}
/**
 * -1, 0 or 1 — or null when either side is not a version this can compare.
 *
 * ⚠ Null is not "equal". A caller that treats it as equal says nothing; one that treats it as
 *   "newer" nags forever about a release that does not exist. Both callers here read it as
 *   "no answer".
 */
export function compareVersions(left, right) {
    const a = VERSION_SHAPE.exec(left);
    const b = VERSION_SHAPE.exec(right);
    if (a === null || b === null)
        return null;
    for (let part = 1; part <= 3; part += 1) {
        const one = Number(a[part]);
        const other = Number(b[part]);
        if (one !== other)
            return one > other ? 1 : -1;
    }
    return 0;
}
/** Is `candidate` a release later than the one running? Unanswerable counts as no. */
export function isNewer(candidate, running) {
    return compareVersions(candidate, running) === 1;
}
/** The page a person can read about one release on. */
export function releasePageUrl(version) {
    return isVersion(version) ? `${TAG_PREFIX}v${version}` : null;
}
/**
 * Where one release's package is.
 *
 * ⛔ THE TAGGED ADDRESS, NEVER "LATEST". This is handed to another program to install, and
 *    "latest" would install whatever is newest at the moment that program runs — which is not
 *    necessarily the version this tool just named on the screen. Naming the release means what
 *    was reported and what gets installed are the same thing.
 */
export function packageUrl(version) {
    if (!isVersion(version))
        return null;
    return `${SOURCE_URL}/releases/download/v${version}/${PACKAGE_ASSET}`;
}
/**
 * The exact command that installs one release, as an argument list.
 *
 * ⛔ A LIST AND NOT A STRING, because it is both printed and run. A string would have to be split
 *    again to be run, and splitting a string is where a shell gets involved — the one thing a
 *    command built partly from a value off the network must not touch. `packageUrl` has already
 *    refused anything that is not three numbers, so nothing here can carry a space, a quote or a
 *    semicolon, and it never needs to.
 */
export function installCommand(version) {
    const url = packageUrl(version);
    return url === null ? null : ["npm", "install", "--global", url];
}
/** The same command as one line, for printing. */
export function installCommandLine(version) {
    const parts = installCommand(version);
    return parts === null ? null : parts.join(" ");
}
/**
 * The one line printed when a newer release exists.
 *
 * ⛔ IT SAYS WHAT IS PUBLISHED AND WHAT IS RUNNING, AND NOTHING ABOUT WHETHER TO UPGRADE. What is
 *    in a release is not known here, and a line that called it important, recommended or a fix
 *    would be inventing a reason to act.
 */
export function newerVersionLine(latest, running, binary) {
    return `${binary} ${latest} is published; this is ${running}. \`${binary} update\` installs it.`;
}
