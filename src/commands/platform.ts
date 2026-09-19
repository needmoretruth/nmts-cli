// `nmts platform` — the two things a business does from a terminal.
//
// ⛔ THE KEY PAIR IS MADE HERE AND REGISTERED SOMEWHERE ELSE. Making it needs nothing but a random
//    source; registering it needs a signed-in person, because attaching a standing credential to
//    an account is a decision a session alone may not make. So `keygen` does the half a terminal
//    can do and `register` says, in one sentence, where the other half is.
//
// ⛔ THE PRIVATE HALF IS NEVER PRINTED. It goes into a file only its owner can read and nowhere
//    else — not to stdout, not into a message, not into the run log. What this command puts on the
//    screen is the PUBLIC half, which is what gets pasted into the browser.
//
// ⛔ AND THE FILE IS NEVER REPLACED. `--force` does not open it: the file it would overwrite may
//    hold the only copy of a key a business is already registered under, and replacing it locks
//    that business out of its own door with nothing able to bring the key back.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { modesAreEnforced } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { generateBusinessKeys } from "../platform-sign.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { STDOUT_TARGET } from "../stdout.ts";

/** Where the pair goes when `--out` names nowhere. Beside whatever the business is running. */
export const DEFAULT_KEY_FILE = "nmts-business-key.json";

/** Where a person registers the public half. The one path this command exists to name. */
export const REGISTER_PATH = "Settings › Developer › Platform";

export interface PlatformOptions {
  out?: string | undefined;
  write?: ((line: string) => void) | undefined;
}

export function platform(sub: string | undefined, options: PlatformOptions = {}): number {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  switch (sub) {
    case "keygen":
      return keygen(options.out, say);
    case "register":
      return register(say);
    default:
      throw new NmtsError(sub === undefined ? "`platform` needs a subcommand." : `Unknown subcommand: ${sub}`, {
        exitCode: 2,
        nextStep:
          `\`${BINARY_NAME} platform keygen\` makes the key pair a business signs with; ` +
          `\`${BINARY_NAME} platform register\` says where the public half is registered.`,
      });
  }
}

/** Make the pair, write it where only its owner can read it, and print the half that is not secret. */
function keygen(out: string | undefined, say: (line: string) => void): number {
  const path = targetFor(out);
  const keys = generateBusinessKeys();
  writeKeyFile(path, keys);
  say(`Public key: ${keys.publicKey}`);
  say(`Written to: ${path}`);
  // The same sentence `nmts doctor` uses for a stored key: where no mode applies, say so.
  if (!modesAreEnforced()) {
    say(
      `Windows applies no POSIX file mode, so this file inherits its folder's permissions ` +
        `rather than being restricted to one user.`,
    );
  }
  say(`Register the public key at ${HOME_URL} — ${REGISTER_PATH}. The private half stays in that file.`);
  return 0;
}

/**
 * Say where registering happens, and stop.
 *
 * ⛔ EXIT 2, WHICH IS "THE COMMAND LINE WAS WRONG" AND NOT "IT FAILED". An agent that read this as
 *    a transient failure would try it again; the code says the request cannot be made this way at
 *    all, whatever the arguments are.
 */
function register(say: (line: string) => void): number {
  say(`Registering a business needs a signed-in browser session, so this tool cannot do it.`);
  say(`Open ${HOME_URL} and go to ${REGISTER_PATH}.`);
  say(`Paste the public key from \`${BINARY_NAME} platform keygen\` there.`);
  return 2;
}

/** Where the file goes, refusing a name that is already taken and refusing stdout outright. */
function targetFor(out: string | undefined): string {
  const named = out === undefined || out === "" ? DEFAULT_KEY_FILE : out;
  if (named === STDOUT_TARGET) {
    throw new NmtsError("The business key pair will not be sent to stdout.", {
      exitCode: 2,
      nextStep:
        "Nothing was made. stdout is what a program reads and a log keeps, and this file holds " +
        "the private half. Name a file instead.",
    });
  }
  const path = isAbsolute(named) ? named : resolve(process.cwd(), named);
  let existing: ReturnType<typeof statSync> | null = null;
  try {
    existing = statSync(path);
  } catch {
    // Not there is exactly what this wants.
  }
  if (existing !== null) {
    throw new NmtsError(`${path} is already there.`, {
      exitCode: 4,
      nextStep: existing.isDirectory()
        ? "--out names the FILE the key pair goes into, not a directory."
        : "Nothing was made. That file is not replaced, whatever --force says: it may hold the " +
          "key a business is already registered under. Name one that does not exist.",
    });
  }
  return path;
}

/**
 * Write the pair, readable by nobody else.
 *
 * ⚠ `wx` FAILS IF THE NAME APPEARED SINCE THE CHECK ABOVE, which is the point of using it rather
 *   than trusting that check: between the two, something else may have written there.
 *
 * ⚠ ON WINDOWS THE MODE IS IGNORED and the file inherits the folder's permissions — the same limit
 *   every other file this tool writes has, and claiming otherwise would claim a guarantee the
 *   platform does not give.
 */
function writeKeyFile(path: string, keys: { publicKey: string; privateKey: string }): void {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  // ⚠ The field names are the ones the library takes, so the parsed file goes straight into a
  //   client without a program in the middle renaming anything.
  const text = `${JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2)}\n`;
  try {
    writeFileSync(path, text, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // ⛔ THE CAUSE IS NAMED AND THE KEY IS NOT. The errno line carries the path and never the
    //    contents, so it is safe to pass on.
    throw new NmtsError(`The key pair could not be written to ${path}.`, {
      exitCode: 1,
      nextStep: `Nothing was made. Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
