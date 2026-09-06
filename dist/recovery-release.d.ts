/**
 * The standalone program, by the name it is published under.
 *
 * ⛔ ONE SPELLING FOR THE WHOLE PACKAGE. It is the executable's file name, the prefix of every
 *    asset in the table below, and the word the sealed file list writes into its own header so
 *    that whoever finds that file years later knows what reads it. Two copies of this string is
 *    how a rename lands in one of those places and not the others.
 */
export declare const RECOVERY_TOOL = "nmts-recovery";
/**
 * Where that program's source and its releases are.
 *
 * ⚠ Printed as text into a file that has no links, and used to build the download addresses. It
 *   is the same one either way, so it is written down once.
 */
export declare const RECOVERY_TOOL_URL = "https://github.com/needmoretruth/nmts-recovery";
/** One executable the release publishes. */
export interface PublishedExecutable {
    /** The `process.platform` it was built for. */
    platform: string;
    /** The `process.arch` it was built for. */
    arch: string;
    /** The file name the release attaches it under. */
    asset: string;
    /** How a person says that platform out loud, for the refusal a machine without one gets. */
    label: string;
}
/**
 * Every executable the release workflow attaches, in the order it builds them.
 *
 * ⚠ macOS carries the marketing word in brackets because "aarch64" and "x86_64" are not what
 *   anybody's machine calls itself on that platform — the person reading a refusal has to be able
 *   to tell whether their own machine is in this list.
 */
export declare const PUBLISHED: readonly PublishedExecutable[];
/** The checksum file the release attaches beside the executables. */
export declare const SUMS_FILE = "SHA256SUMS";
/** The one this machine can run, or null when the release publishes nothing for it. */
export declare function executableFor(platform: string, arch: string): PublishedExecutable | null;
/** The published platforms, for telling somebody their own is not among them. */
export declare function publishedLabels(): readonly string[];
/**
 * The exact commands that build this program from source.
 *
 * ⛔ EXACT, NOT "BUILD IT YOURSELF". Somebody reading this is on an unusual machine and has
 *    already lost access to their files; "see the repository" is a research task, and three lines
 *    they can paste is not.
 */
export declare function buildFromSource(sourceUrl: string): readonly string[];
/**
 * What checking the bytes against SHA256SUMS shows, and what it does not.
 *
 * ⛔ BOTH SENTENCES, ALWAYS TOGETHER, AND WORDED ONCE. They are printed by the command and
 *    repeated in the help text, and if they were written twice one copy would eventually start
 *    promising more than the other. There is no "verified", no "trusted" and no "safe" in either
 *    of them on purpose: a checksum published by the same release as the file it describes proves
 *    the two agree, and nothing whatsoever about who produced them.
 */
export declare const CHECK_PROVES: string;
/** The other half. Never printed without the one above it. */
export declare const CHECK_DOES_NOT_PROVE: string;
/** `SHA256SUMS` for whatever the source repository's newest release is. */
export declare function sumsUrl(sourceUrl: string): string;
/** One asset of one NAMED release. Never "latest": the tag is resolved once and then reused. */
export declare function assetUrl(sourceUrl: string, tag: string, asset: string): string;
/**
 * The release tag a URL names, or null when it does not name one.
 *
 * Split into segments rather than matched with a regex because the file name can contain the
 * characters a regex cares about (`nmts-recovery-windows-x86_64.exe`), and an escaping mistake
 * there would be a silently looser check.
 */
export declare function tagFromUrl(url: string, filename: string): string | null;
/**
 * The tag the redirect chain resolved to, or null.
 *
 * ⛔ THE WHOLE CHAIN, NOT THE LAST HOP. `…/releases/latest/download/SHA256SUMS` redirects to the
 *    tagged address and that one redirects again to wherever the bytes are actually served from,
 *    which carries no tag at all. Reading only where the chain ended would find nothing.
 */
export declare function tagFromChain(chain: readonly string[], filename: string): string | null;
/** What a lookup in `SHA256SUMS` found, or why it found nothing usable. */
export type SumsLookup = {
    found: true;
    hash: string;
} | {
    found: false;
    why: "missing" | "repeated" | "malformed";
};
/**
 * The hash `SHA256SUMS` gives for one asset.
 *
 * ⛔ TWO LINES FOR ONE NAME IS A REFUSAL, NOT A FIRST-WINS. A file listed twice with different
 *    hashes has no answer, and picking one would mean this command decides which of two claims to
 *    act on. It has no basis for that, so it says so instead.
 */
export declare function hashFromSums(sums: string, asset: string): SumsLookup;
/**
 * Break one long sentence into lines a terminal will not fold in the middle of a word.
 *
 * ⚠ The two sentences above are written once, as prose, so the help text and the command cannot
 *   drift apart. Prose has to be wrapped somewhere, and doing it here keeps the wording out of it.
 */
export declare function wrapText(text: string, width?: number): string[];
