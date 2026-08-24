// `nmts listfile` — writing this machine's copy of the sealed file list out as a file.
//
// ⛔ WHY A COPY IS WORTH ANYTHING. The list is where every file's NAME, folder and KEY live. The
//    server holds it sealed and cannot read it — and an account whose list the server loses is an
//    account of nameless, unopenable files, even though every byte is still stored. A copy on
//    somebody's own disk is the answer to that, and it is the artefact an account used only from a
//    terminal never had: the browser keeps one and can hand it over, this tool kept two numbers.
//
// ⛔ IT ANSWERS FROM THIS MACHINE, AND ASKS NOTHING OF ANYBODY. No API key, no server, no network.
//    What it writes is the copy kept beside the rollback record, refreshed every time this tool
//    read a newer list — so the version it hands over is the newest version this machine has seen,
//    which is a fact it can state exactly rather than a promise about the account.
//
// ⛔ WHAT THE FILE IS NOT. It is not a recovery on its own. The storage network's addresses are not
//    in it — those live in the recovery list a browser writes — and neither is the account code,
//    deliberately: this file plus the code IS the account, and keeping both together turns one
//    theft into a total loss. Both facts are printed, and both are inside the file for whoever
//    finds it later without this text.

import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { identityOf } from "../account.ts";
import { requireAccountCode } from "../code-access.ts";
import { NmtsError } from "../errors.ts";
import { buildFileListFile } from "../list-file.ts";
import { readKeptList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";

export interface ListFileOptions {
  /**
   * Where to write it: a directory, a file name, or `-` for standard output. Default: this
   * directory, under the name the file describes itself with.
   */
  out?: string | undefined;
  /** Replace a file that is already there. */
  force?: boolean;
  write?: (line: string) => void;
  /** Where the document goes when `--out -` asked for it. */
  writeDocument?: (text: string) => void;
}

export async function listfile(options: ListFileOptions = {}): Promise<number> {
  const toStdout = options.out === "-";
  // ⛔ WITH `--out -` EVERY LINE FOR A PERSON GOES TO STDERR. The document is then the only thing
  //    on standard output, so `… --out - > copy.nmtslist` produces a file and not a file with an
  //    explanation glued to the front of it.
  const say =
    options.write ??
    ((line: string) => process[toStdout ? "stderr" : "stdout"].write(`${line}\n`));
  const emit = options.writeDocument ?? ((text: string) => process.stdout.write(text));

  const resolved = await requireAccountCode();
  const identity = await identityOf(resolved.code);

  const kept = readKeptList(identity.accountId);
  if (kept === null) {
    throw new NmtsError(`This machine has no copy of this account's file list.`, {
      exitCode: 4,
      nextStep:
        `Nothing was written. Run \`${BINARY_NAME} ls\` once while this machine can reach the ` +
        `server: every read of the list keeps its sealed bytes here, and this command writes that ` +
        `copy out. A copy cannot be made from the account code alone — the list itself is what is ` +
        `being copied.`,
    });
  }

  const file = buildFileListFile({
    accountId: identity.accountId,
    seq: kept.seq,
    savedAt: kept.savedAt,
    sealed: kept.ct,
  });

  if (toStdout) {
    emit(file.content);
    saidWhatItIs(say, kept.seq, kept.savedAt, file.filename);
    return 0;
  }

  const destination = destinationFor(options.out, file.filename);
  try {
    // ⛔ `wx` UNLESS TOLD OTHERWISE, and 0600 either way. Replacing a file nobody asked to replace
    //    is not this command's decision, and the bytes are one account's whole file list.
    writeFileSync(destination, file.content, { flag: options.force === true ? "w" : "wx", mode: 0o600 });
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
      throw new NmtsError(`${destination} is already there.`, {
        exitCode: 4,
        nextStep: `Nothing was written. Pass --out to choose another name, or --force to replace it.`,
      });
    }
    throw error;
  }
  say(`Wrote ${destination}`);
  saidWhatItIs(say, kept.seq, kept.savedAt, file.filename);
  return 0;
}

/** Where the file goes: the given file name, inside the given directory, or this directory. */
function destinationFor(out: string | undefined, filename: string): string {
  if (out === undefined) return join(process.cwd(), filename);
  const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
  // A directory that exists means "put it in here under its own name"; anything else is the name
  // to write. Guessing the other way round would silently rename the artefact whose filename is
  // how a person tells two copies apart.
  if (existsSync(target) && statSync(target).isDirectory()) return join(target, filename);
  return target;
}

/**
 * The two sentences that stop this file from being mistaken for a recovery.
 *
 * ⛔ SAID ON EVERY RUN, not once in a manual. The moment somebody reaches for this file is the
 *    moment those two facts matter, and it is not the moment anybody goes looking for a document.
 */
function saidWhatItIs(
  say: (line: string) => void,
  seq: number,
  savedAt: string,
  filename: string,
): void {
  say(``);
  say(`  File list version ${seq}, as this machine last read it (${savedAt}).`);
  say(`  It holds the names, folders and file keys of this account, sealed with the account code.`);
  say(``);
  say(`  ⛔ It is not a recovery on its own. It carries no storage-network addresses — those are in`);
  say(`     the recovery list saved from the account screen — and it does not contain the account`);
  say(`     code. Keep it somewhere other than the code: together they are the whole account.`);
  say(`  ⚠ A copy goes stale. Run this again after uploading: of two copies, the one whose`);
  say(`    filename carries the higher number supersedes the other (this one is ${filename}).`);
}
