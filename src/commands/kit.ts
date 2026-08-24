// `nmts kit` — the recovery kit: one file that is enough to get everything back.
//
// ⛔⛔ IT WRITES THE ACCOUNT CODE IN THE CLEAR. That is the format, decided deliberately: the point
//    of the kit is that a person needs ONE thing, not two. So whoever holds this file holds the
//    account and the wallet, and this command says exactly that at the moment it writes — not in a
//    manual, not on a website. The moment somebody makes this file is the moment that fact
//    matters, and it is not the moment anybody goes looking for a document.
//
// ⛔ IT WRITES NOWHERE BUT THE PATH THE CALLER NAMED. Nothing is copied into this tool's own
//    directory, nothing is left in a temporary file, nothing is printed to the terminal. A command
//    that quietly kept a second copy of an account code would be the worst defect in this program.
//
// ⛔ AND IT NEVER REPLACES A FILE NOBODY ASKED IT TO REPLACE. A taken name is a refusal unless
//    `--force` says otherwise — the same rule every other writing command here follows.
//
// ⛔ NO PARTIAL KIT. If the recovery list cannot be built, nothing is written and the reason is
//    printed. The browser has a third state for this — a kit whose text says "the list could not
//    be made this time" — because it is a screen and can carry that sentence to the person who
//    just pressed the button. This file's MACHINE block has no field for it: `recovery_list: null`
//    means "this account had no files", and writing that for a build that failed would state the
//    opposite of the truth in the one document somebody keeps for the worst day. So it refuses.

import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { identityOf } from "../account.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { buildRecoveryKit } from "../kit-file.ts";
import { assembleRecoveryList, recordRecoveryList } from "../recovery-assemble.ts";

export interface KitOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Where to put it: a directory, or the file name to write. Default: this directory. */
  out?: string | undefined;
  /** Replace a file that is already there. */
  force?: boolean;
  json?: boolean;
  write?: (line: string) => void;
}

export async function kit(options: KitOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const assembled = await assembleRecoveryList({
    server: options.server,
    network: options.network,
  });
  const { built, session } = assembled;

  // The sealed list is embedded as the SAME document `nmts recovery-list` writes out, so the
  // standalone program reads one shape whichever file it is handed.
  const parsed: unknown = JSON.parse(assembled.file.content);
  if (!isRecord(parsed)) {
    throw new NmtsError("The recovery list did not come back as a document.", {
      exitCode: 1,
      nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
    });
  }

  const identity = await identityOf(session.code);
  const file = buildRecoveryKit({
    // ⛔ THE GROUPED FORM, which is what a person reads and types back. The kit is the artefact a
    //    person is told to print or to put in a drawer.
    code: identity.displayCode,
    accountId: session.accountId,
    generatedAt: nowFrom(parsed),
    // ⚠ AN EMPTY ACCOUNT GETS `null`, WHICH MEANS "there were no files", and that is true here:
    //   the list was built and it covers nothing. It is NOT the spelling for a build that failed —
    //   this command refuses instead of reaching this line with an unknown.
    recoveryList: built.fileCount === 0 ? null : parsed,
    listFileCount: built.fileCount === 0 ? null : built.fileCount,
  });

  const destination = destinationFor(options.out, file.filename);
  if (options.force !== true && existsSync(destination)) throw alreadyThere(destination);
  try {
    // ⛔ 0600, AND IT IS NOT A FORMALITY HERE. This file is the account code. On a filesystem that
    //    cannot keep the mode, this is still the only protection there is to ask for.
    writeFileSync(destination, file.content, {
      flag: options.force === true ? "w" : "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
      throw alreadyThere(destination);
    }
    throw error;
  }

  // The kit embeds a real recovery list, so the account's record moves with it — `kind: "local"`,
  // the same fact `nmts recovery-list` reports: a list exists and the person is keeping it.
  await recordRecoveryList(assembled, destination);

  if (options.json === true) {
    say(
      JSON.stringify({
        writtenTo: destination,
        mode: "0600",
        seq: assembled.seq,
        files: built.fileCount,
        // ⛔ THE SENTENCE REACHES A READER THAT ONLY PARSES JSON. An agent that hands this file to
        //    somebody has to be able to say what it is, in the same words.
        carries: ["account-code", "recovery-list"],
        warning:
          "This file contains the account code in the clear. Anyone who holds it holds the " +
          "account and the wallet.",
        missingFromSource: built.missingFromSource,
      }),
    );
    return 0;
  }

  say(`Wrote ${destination}`);
  say(``);
  say(`  ⛔ This file contains your account code in the clear, together with the recovery list`);
  say(`     for ${built.fileCount} file(s). Anyone who holds it holds this account: every file in`);
  say(`     it, and the wallet that pays for storage. One account code opens both.`);
  say(``);
  say(`  It was written only where you see it, with permissions 0600, and nowhere else.`);
  say(`  Do not keep it in a folder that syncs or backs up on its own, and do not send it to`);
  say(`  anyone. A drawer is often safer than a cloud folder.`);
  if (built.missingFromSource.length > 0) {
    say(``);
    say(`  ⚠ ${built.missingFromSource.length} file(s) in your file list are not in the account's`);
    say(`    stored files, so they are not in this kit.`);
  }
  return 0;
}

/**
 * The instant the embedded list was taken, read back out of the document rather than re-stamped.
 *
 * ⛔ THE TWO HALVES OF THIS FILE MUST NOT CLAIM DIFFERENT MOMENTS. A person comparing "Created" at
 *    the top with `generated_at` inside would have no way to tell which one to believe.
 */
function nowFrom(mapFile: Record<string, unknown>): string {
  const at = mapFile["generated_at"];
  return typeof at === "string" && at.length > 0 ? at : new Date().toISOString();
}

/** Where the file goes: the given file name, inside the given directory, or this directory. */
function destinationFor(out: string | undefined, filename: string): string {
  if (out === undefined) return join(process.cwd(), filename);
  const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
  // A directory that exists means "put it in here under its own name"; anything else is the name
  // to write.
  if (existsSync(target) && statSync(target).isDirectory()) return join(target, filename);
  return target;
}

function alreadyThere(destination: string): NmtsError {
  return new NmtsError(`${destination} is already there.`, {
    exitCode: 4,
    nextStep:
      `Nothing was written, and no account code was put anywhere. Pass --out to choose another ` +
      `name, or --force to replace it.`,
  });
}
