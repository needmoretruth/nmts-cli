// Where the standalone recovery program's executables come from, and which one this machine needs.
//
// ⛔ THE ASSET NAMES ARE A CONTRACT WITH ANOTHER REPOSITORY'S RELEASE WORKFLOW. That workflow
//    builds one executable per platform and attaches it under exactly the name in the table below.
//    They are not decoration and they are not guessed here: a name that drifts from the workflow's
//    becomes a 404, and a 404 on this path reads as "there is no release" to somebody who has just
//    lost access to their files. That is the worst sentence this command could say, and it would
//    be a lie. `deploy/check-recovery-assets.mjs` set-compares this table against the workflow so
//    the copy cannot go stale quietly.
//
// ⛔ RAW EXECUTABLES, NOT ARCHIVES, and that is the release's decision rather than a convenience.
//    This tool has no archive reader; adding one would mean a dependency in a program whose whole
//    claim is that you can read what it does. One file per platform, downloaded and run.
//
// ⛔ NO NEAR MATCHES. A machine whose platform is not in the table is told so, told which ones are
//    published, and told how to build from source. Handing an aarch64 machine an x86_64 executable
//    produces "cannot execute binary file", which sends a person debugging their shell instead of
//    reading one honest sentence.

/**
 * The standalone program, by the name it is published under.
 *
 * ⛔ ONE SPELLING FOR THE WHOLE PACKAGE. It is the executable's file name, the prefix of every
 *    asset in the table below, and the word the sealed file list writes into its own header so
 *    that whoever finds that file years later knows what reads it. Two copies of this string is
 *    how a rename lands in one of those places and not the others.
 */
export const RECOVERY_TOOL = "nmts-recovery";

/**
 * Where that program's source and its releases are.
 *
 * ⚠ Printed as text into a file that has no links, and used to build the download addresses. It
 *   is the same one either way, so it is written down once.
 */
export const RECOVERY_TOOL_URL = "https://github.com/needmoretruth/nmts-recovery";

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
export const PUBLISHED: readonly PublishedExecutable[] = [
  { platform: "linux", arch: "x64", asset: "nmts-recovery-linux-x86_64", label: "Linux x86_64" },
  { platform: "linux", arch: "arm64", asset: "nmts-recovery-linux-aarch64", label: "Linux aarch64" },
  {
    platform: "darwin",
    arch: "arm64",
    asset: "nmts-recovery-macos-aarch64",
    label: "macOS aarch64 (Apple silicon)",
  },
  { platform: "darwin", arch: "x64", asset: "nmts-recovery-macos-x86_64", label: "macOS x86_64 (Intel)" },
  {
    platform: "win32",
    arch: "x64",
    asset: "nmts-recovery-windows-x86_64.exe",
    label: "Windows x86_64",
  },
];

/** The checksum file the release attaches beside the executables. */
export const SUMS_FILE = "SHA256SUMS";

/** The one this machine can run, or null when the release publishes nothing for it. */
export function executableFor(platform: string, arch: string): PublishedExecutable | null {
  return PUBLISHED.find((e) => e.platform === platform && e.arch === arch) ?? null;
}

/** The published platforms, for telling somebody their own is not among them. */
export function publishedLabels(): readonly string[] {
  return PUBLISHED.map((e) => e.label);
}

/**
 * The exact commands that build this program from source.
 *
 * ⛔ EXACT, NOT "BUILD IT YOURSELF". Somebody reading this is on an unusual machine and has
 *    already lost access to their files; "see the repository" is a research task, and three lines
 *    they can paste is not.
 */
export function buildFromSource(sourceUrl: string): readonly string[] {
  // The directory `git clone` makes is the last segment of the address, so it is read from the
  // address rather than written again: the two cannot then disagree.
  const cloned = sourceUrl.replace(/\/+$/, "").split("/").pop() ?? RECOVERY_TOOL;
  return [`git clone ${sourceUrl}`, `cd ${cloned}/recovery`, `cargo build --release`];
}

/**
 * What checking the bytes against SHA256SUMS shows, and what it does not.
 *
 * ⛔ BOTH SENTENCES, ALWAYS TOGETHER, AND WORDED ONCE. They are printed by the command and
 *    repeated in the help text, and if they were written twice one copy would eventually start
 *    promising more than the other. There is no "verified", no "trusted" and no "safe" in either
 *    of them on purpose: a checksum published by the same release as the file it describes proves
 *    the two agree, and nothing whatsoever about who produced them.
 */
export const CHECK_PROVES =
  `The check compares what arrived against the release's own ${SUMS_FILE}, which shows these ` +
  `bytes are the bytes that release published.`;

/** The other half. Never printed without the one above it. */
export const CHECK_DOES_NOT_PROVE =
  `It does not show who published that release: anybody able to push a tag to that repository can ` +
  `produce both the file and its line in ${SUMS_FILE}.`;

/** `SHA256SUMS` for whatever the source repository's newest release is. */
export function sumsUrl(sourceUrl: string): string {
  return `${sourceUrl.replace(/\/+$/, "")}/releases/latest/download/${SUMS_FILE}`;
}

/** One asset of one NAMED release. Never "latest": the tag is resolved once and then reused. */
export function assetUrl(sourceUrl: string, tag: string, asset: string): string {
  return `${sourceUrl.replace(/\/+$/, "")}/releases/download/${encodeURIComponent(tag)}/${asset}`;
}

/**
 * Tag names this accepts.
 *
 * ⛔ THE TAG COMES OFF THE WIRE AND GOES BACK INTO A URL, so its shape is checked rather than
 *    trusted. A redirect that answered with `../../somewhere` would otherwise decide which path
 *    the second request asks for.
 */
const TAG_SHAPE = /^[A-Za-z0-9._+-]+$/;

/**
 * The release tag a URL names, or null when it does not name one.
 *
 * Split into segments rather than matched with a regex because the file name can contain the
 * characters a regex cares about (`nmts-recovery-windows-x86_64.exe`), and an escaping mistake
 * there would be a silently looser check.
 */
export function tagFromUrl(url: string, filename: string): string | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter((part) => part !== "");
  } catch {
    return null;
  }
  const last = segments.length - 1;
  if (last < 3) return null;
  const name = segments[last];
  const tag = segments[last - 1];
  if (name === undefined || tag === undefined) return null;
  if (segments[last - 2] !== "download" || segments[last - 3] !== "releases") return null;
  let decodedName: string;
  let decodedTag: string;
  try {
    decodedName = decodeURIComponent(name);
    decodedTag = decodeURIComponent(tag);
  } catch {
    return null;
  }
  if (decodedName !== filename) return null;
  if (!TAG_SHAPE.test(decodedTag) || decodedTag.includes("..")) return null;
  return decodedTag;
}

/**
 * The tag the redirect chain resolved to, or null.
 *
 * ⛔ THE WHOLE CHAIN, NOT THE LAST HOP. `…/releases/latest/download/SHA256SUMS` redirects to the
 *    tagged address and that one redirects again to wherever the bytes are actually served from,
 *    which carries no tag at all. Reading only where the chain ended would find nothing.
 */
export function tagFromChain(chain: readonly string[], filename: string): string | null {
  let found: string | null = null;
  for (const url of chain) {
    const tag = tagFromUrl(url, filename);
    if (tag !== null) found = tag;
  }
  return found;
}

/** What a lookup in `SHA256SUMS` found, or why it found nothing usable. */
export type SumsLookup =
  | { found: true; hash: string }
  | { found: false; why: "missing" | "repeated" | "malformed" };

/**
 * The hash `SHA256SUMS` gives for one asset.
 *
 * ⛔ TWO LINES FOR ONE NAME IS A REFUSAL, NOT A FIRST-WINS. A file listed twice with different
 *    hashes has no answer, and picking one would mean this command decides which of two claims to
 *    act on. It has no basis for that, so it says so instead.
 */
export function hashFromSums(sums: string, asset: string): SumsLookup {
  let found: string | null = null;
  let repeated = false;
  let malformed = false;
  for (const raw of sums.split("\n")) {
    // `sha256sum` writes "<hex>  <name>", with a `*` before the name when it read in binary mode.
    const match = /^([0-9a-fA-F]+)[ \t]+\*?(.+)$/.exec(raw.trim());
    if (match === null) continue;
    const hex = match[1];
    const name = match[2];
    if (hex === undefined || name === undefined) continue;
    if (name.trim() !== asset) continue;
    if (hex.length !== 64) {
      malformed = true;
      continue;
    }
    if (found !== null) {
      repeated = true;
      continue;
    }
    found = hex.toLowerCase();
  }
  if (repeated) return { found: false, why: "repeated" };
  if (found !== null) return { found: true, hash: found };
  if (malformed) return { found: false, why: "malformed" };
  return { found: false, why: "missing" };
}

/**
 * Break one long sentence into lines a terminal will not fold in the middle of a word.
 *
 * ⚠ The two sentences above are written once, as prose, so the help text and the command cannot
 *   drift apart. Prose has to be wrapped somewhere, and doing it here keeps the wording out of it.
 */
export function wrapText(text: string, width = 88): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
