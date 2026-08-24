// `nmts recovery` — fetching the standalone recovery program, checked, into a file you name.
//
// ⛔ WHY IT EXISTS. The recovery program is the answer to "NMTS is gone and I still have my
//    account code": it reads files back off the public storage network on its own, talking to no
//    NMTS server. Until its release workflow existed, getting it meant installing a Rust toolchain
//    and building it — a fair ask of somebody auditing it, an unfair one of somebody who has just
//    lost access to their files, and an impossible one for an agent working in a terminal.
//
// ⛔ IT NEVER OVERWRITES AND IT NEVER INSTALLS ITSELF. One file, in the directory the caller
//    named, under the name the release published it as; a name that is taken is a refusal unless
//    `--force` says otherwise; and the full path is printed. Nothing is copied onto a PATH
//    directory, nothing is added to a shell profile, nothing on this machine is made to point at
//    it. A program that quietly drops an executable somewhere the shell will find it has not saved
//    anybody a step — it has taken a decision that was not its to take.
//
// ⛔ THE BYTES ARE CHECKED BEFORE THEY ARE MADE RUNNABLE. `SHA256SUMS` is fetched first, the tag
//    the release resolved to is taken out of that request's redirects, and the executable is then
//    asked for from THAT tag — never from "latest" a second time, which could answer from a
//    release published in between. The file is written without an executable bit, hashed, and only
//    then made runnable; a hash that does not match leaves nothing on the disk at all.
//
// ⛔ IT IS NOT AN MCP TOOL, AND MUST NOT BECOME ONE. `commands/mcp.ts` offers a model four things:
//    who the account is, what is in it, one file out and one file in. Downloading an executable
//    and setting its executable bit is not a step a model takes on somebody's behalf — the person
//    who runs this has to be the person who decided to have it.
//
// ⚠ WHAT IT ASKS OF THE NETWORK IS NOT THE NMTS API. It talks to the source-hosting site the
//   recovery program is published on, and to nothing else; no account code, no API key and no
//   session is involved, and the command works signed out.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { NmtsError } from "../errors.ts";
import {
  assetUrl,
  buildFromSource,
  CHECK_DOES_NOT_PROVE,
  CHECK_PROVES,
  executableFor,
  hashFromSums,
  publishedLabels,
  RECOVERY_TOOL,
  RECOVERY_TOOL_URL,
  SUMS_FILE,
  sumsUrl,
  tagFromChain,
  wrapText,
} from "../recovery-release.ts";

/** A download that stalls is a download that failed, and this one is a few megabytes. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * How many hops one address may take.
 *
 * ⚠ Two are ordinary — "latest" to the tagged address, and that to wherever the bytes are served
 *   from. More than a handful is a loop, and a loop with no cap is a command that never returns.
 */
const MAX_REDIRECTS = 5;

/** `SHA256SUMS` lists five short lines. Anything approaching this is not that file. */
const MAX_SUMS_BYTES = 1024 * 1024;

/**
 * A ceiling on the executable.
 *
 * ⛔ THE WHOLE FILE IS HELD IN MEMORY, because it has to be hashed before any of it is allowed to
 *    become runnable. That makes "how big is it" a question this command has to answer rather than
 *    discover: the published ones are single-digit megabytes, and this is ten times over.
 */
const MAX_EXECUTABLE_BYTES = 128 * 1024 * 1024;

export interface RecoveryOptions {
  /** Where to put it: a directory, or the file name to write. Default: the working directory. */
  out?: string | undefined;
  /** Replace a file that is already there. Off by default, and saying so is the point. */
  force?: boolean;
  json?: boolean;
  write?: (line: string) => void;
  /**
   * Where the program is published.
   *
   * ⚠ Overridable so a test can drive the whole download against a server on this machine. There
   *   is no command-line option for it: this is not somewhere a person should be talked into
   *   pointing an executable download.
   */
  source?: string | undefined;
  /**
   * What machine to fetch for.
   *
   * ⚠ Overridable so the refusal a machine with no published executable gets can be tested on a
   *   machine that has one. Defaults to what this process is running on.
   */
  platform?: string;
  arch?: string;
}

export async function recovery(options: RecoveryOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const source = options.source ?? RECOVERY_TOOL_URL;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  const wanted = executableFor(platform, arch);
  if (wanted === null) throw noExecutableFor(platform, arch, source);

  // ⛔ ASKED BEFORE ANYTHING IS DOWNLOADED. A taken name is a refusal either way, and finding out
  //    after several megabytes have crossed somebody's connection helps nobody. The reservation
  //    that actually makes it safe is the `wx` write below — this is the fast half of it.
  const destination = destinationFor(options.out, wanted.asset);
  if (options.force !== true && existsSync(destination)) throw alreadyThere(destination, "downloaded");

  const sums = await fetched(sumsUrl(source), MAX_SUMS_BYTES, SUMS_FILE);
  // ⛔ THE TAG COMES OUT OF THE REQUEST THAT WAS JUST ANSWERED. Asking for "latest" a second time
  //    would be a second question, and two questions can get two answers: a release published
  //    between them would hand over an executable that the sums in hand do not describe, and the
  //    mismatch would look like a corrupt download rather than what it is.
  const tag = tagFromChain(sums.chain, SUMS_FILE);
  if (tag === null) throw unresolvedRelease(source);

  const lookup = hashFromSums(new TextDecoder().decode(sums.bytes), wanted.asset);
  if (!lookup.found) throw noLineFor(wanted.asset, tag, lookup.why);

  const from = assetUrl(source, tag, wanted.asset);
  const got = await fetched(from, MAX_EXECUTABLE_BYTES, wanted.asset);

  // ⛔ 0600 AND NOT EXECUTABLE. The bit that makes this runnable goes on further down, after the
  //    hash matched — between here and there the file on the disk is bytes nobody has checked, and
  //    a run interrupted in that window must not leave something a shell will start.
  try {
    writeFileSync(destination, got.bytes, { flag: options.force === true ? "w" : "wx", mode: 0o600 });
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
      throw alreadyThere(destination, "written");
    }
    throw error;
  }

  const digest = createHash("sha256").update(got.bytes).digest("hex");
  if (digest !== lookup.hash) {
    // ⛔ NOTHING IS LEFT BEHIND. A file that failed this check is not a partial download to resume
    //    or an artefact to inspect — it is bytes of unknown provenance under the name of a program
    //    somebody is about to run when everything else has already gone wrong.
    //
    // ⚠ WITH `--force` THAT MEANS THE OLD FILE IS GONE TOO, and it is the honest outcome rather
    //   than an oversight: `--force` said this name was the caller's to replace, and the two
    //   things that could be left here are a file they asked to be rid of and one nothing
    //   checked. Without `--force` this branch is only ever reached for a file this run made.
    rmSync(destination, { force: true });
    throw doesNotMatch(wanted.asset, tag, lookup.hash, digest);
  }

  // ⚠ THE HOST'S PLATFORM DECIDES, not the one being fetched for: the bit is a property of the
  //   filesystem being written to. Windows has no executable bit and `chmod` there is a no-op at
  //   best, so it is not asked for.
  if (process.platform !== "win32") chmodSync(destination, 0o700);

  if (options.json === true) {
    say(
      JSON.stringify({
        program: RECOVERY_TOOL,
        platform: wanted.label,
        asset: wanted.asset,
        release: tag,
        from,
        writtenTo: destination,
        bytes: got.bytes.length,
        sha256: digest,
        // ⛔ BOTH SENTENCES REACH A READER THAT ONLY PARSES JSON. An agent handing this file to
        //    somebody has to be able to say what was and was not established, in the same words.
        proves: CHECK_PROVES,
        doesNotProve: CHECK_DOES_NOT_PROVE,
      }),
    );
    return 0;
  }

  say(`Wrote ${destination}`);
  say(``);
  say(`  ${RECOVERY_TOOL} for ${wanted.label}, from release ${tag}`);
  say(`  ${from}`);
  say(`  sha256 ${digest}`);
  say(``);
  for (const line of wrapText(CHECK_PROVES)) say(`  ${line}`);
  for (const line of wrapText(CHECK_DOES_NOT_PROVE)) say(`  ${line}`);
  say(``);
  for (const line of wrapText(
    `Nothing was installed. The file is where you see it and nowhere else — no copy was put on ` +
      `your PATH, and nothing on this machine was pointed at it. Run it with \`--help\` to see ` +
      `what it does.`,
  )) {
    say(`  ${line}`);
  }
  return 0;
}

/** Where the file goes: the given file name, inside the given directory, or this directory. */
function destinationFor(out: string | undefined, asset: string): string {
  if (out === undefined) return join(process.cwd(), asset);
  const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
  // A directory that exists means "put it in here under its published name"; anything else is the
  // name to write. Guessing the other way round would write a file called `bin`.
  if (existsSync(target) && statSync(target).isDirectory()) return join(target, asset);
  return target;
}

/** One fetch, and every address it passed through on the way. */
interface Fetched {
  bytes: Uint8Array;
  /** Addresses in the order they were asked, the first being the one this started from. */
  chain: string[];
}

/**
 * Fetch one address, following redirects by hand.
 *
 * ⛔ BY HAND BECAUSE THE CHAIN IS THE ANSWER. `redirect: "follow"` reports only where a request
 *    ended, and where this one ends carries no release tag — the hop that names the tag is in the
 *    middle. Following it here is what lets the executable be asked for from the same release as
 *    the sums, which is the whole point of checking them.
 */
async function fetched(from: string, cap: number, what: string): Promise<Fetched> {
  const chain = [from];
  let current = from;
  const wasSecure = new URL(from).protocol === "https:";
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new NmtsError(`${what} could not be fetched: ${because(error)}`, {
        exitCode: 1,
        nextStep:
          `Nothing was written. This talks to the site the recovery program is published on, not ` +
          `to NMTS — check that this machine can reach it, and try again.`,
      });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      // The body of a redirect is not part of the answer; reading it releases the connection.
      await response.arrayBuffer().catch(() => undefined);
      if (location === null || location === "") {
        throw new NmtsError(`${what} was redirected to nowhere (${response.status}).`, {
          exitCode: 1,
          nextStep: `Nothing was written. The release page answered in a shape this cannot follow.`,
        });
      }
      const next = new URL(location, current);
      // ⛔ A REDIRECT MAY NOT DOWNGRADE THE CONNECTION. A request that started encrypted and is
      //    talked down to a plain one hands whoever is in the middle the executable to write.
      if (wasSecure && next.protocol !== "https:") {
        throw new NmtsError(`${what} was redirected off an encrypted connection.`, {
          exitCode: 1,
          nextStep: `Nothing was written. This refuses rather than fetching an executable in the clear.`,
        });
      }
      current = next.toString();
      chain.push(current);
      continue;
    }
    if (!response.ok) {
      throw new NmtsError(`${what} — the release answered ${response.status}.`, {
        exitCode: 1,
        nextStep:
          response.status === 404
            ? `Nothing was written. That file is not attached to the release this resolved to.`
            : `Nothing was written. Try again; if it keeps answering this, the release page is the ` +
              `place to look.`,
      });
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > cap) throw tooBig(what, cap);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // ⚠ Asked again after the fact: the header above is a claim, and this is the measurement.
    if (bytes.length > cap) throw tooBig(what, cap);
    return { bytes, chain };
  }
  throw new NmtsError(`${what} was redirected more than ${MAX_REDIRECTS} times.`, {
    exitCode: 1,
    nextStep: `Nothing was written.`,
  });
}

function because(error: unknown): string {
  return error instanceof Error ? error.message : "no answer";
}

function tooBig(what: string, cap: number): NmtsError {
  return new NmtsError(`${what} is larger than ${Math.round(cap / (1024 * 1024))} MiB.`, {
    exitCode: 4,
    nextStep:
      `Nothing was written. The published executables are a few megabytes; whatever answered is ` +
      `not one of them.`,
  });
}

function alreadyThere(destination: string, verb: string): NmtsError {
  return new NmtsError(`${destination} is already there.`, {
    exitCode: 4,
    nextStep: `Nothing was ${verb}. Pass --out to choose another name, or --force to replace it.`,
  });
}

function noExecutableFor(platform: string, arch: string, source: string): NmtsError {
  const lines = [
    `Nothing was downloaded. The release publishes one for each of these, and this machine ` +
      `matches none of them:`,
    ``,
    ...publishedLabels().map((label) => `  ${label}`),
    ``,
    `It builds from source on anything a Rust toolchain runs on:`,
    ``,
    ...buildFromSource(source).map((command) => `  ${command}`),
    ``,
    `The source, and what it does, are at ${source}.`,
  ];
  return new NmtsError(`No recovery program is published for ${platform} ${arch}.`, {
    exitCode: 4,
    nextStep: lines.join("\n"),
  });
}

function unresolvedRelease(source: string): NmtsError {
  return new NmtsError(`The newest release did not resolve to a named one.`, {
    exitCode: 4,
    nextStep:
      `Nothing was written. This follows ${SUMS_FILE} to the release it belongs to so the ` +
      `executable can be asked for from that same release, and the address it was handed does not ` +
      `name one. The releases are listed at ${source}/releases.`,
  });
}

function noLineFor(asset: string, tag: string, why: "missing" | "repeated" | "malformed"): NmtsError {
  const detail =
    why === "repeated"
      ? `${SUMS_FILE} in release ${tag} lists ${asset} more than once.`
      : why === "malformed"
        ? `${SUMS_FILE} in release ${tag} lists ${asset} with something that is not a SHA-256 hash.`
        : `${SUMS_FILE} in release ${tag} has no line for ${asset}.`;
  return new NmtsError(detail, {
    exitCode: 4,
    nextStep:
      `Nothing was downloaded. Without a line to compare against there is nothing to check the ` +
      `bytes with, and this does not hand over an executable it did not check.`,
  });
}

function doesNotMatch(asset: string, tag: string, expected: string, got: string): NmtsError {
  return new NmtsError(`${asset} is not the file release ${tag} published.`, {
    exitCode: 4,
    nextStep:
      `The downloaded file was deleted. ${SUMS_FILE} says ${expected}; what arrived hashes to ` +
      `${got}. Run this again — a download can be cut short — and if it says the same thing twice, ` +
      `do not run the file.`,
  });
}
