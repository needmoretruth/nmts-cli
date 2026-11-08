// How this program ends.
//
// ⛔ SPLIT OUT OF `main.ts` RATHER THAN INVENTED. Each of these was written there and moved here
//    unchanged, on the day that file passed the length gate — the rule in this repository is that
//    a file gets divided when it is being worked on. What belongs together here is "the shape of
//    the ending": everything in `main.ts` decides WHAT to do, and everything here decides how the
//    process stops saying so — the code it leaves behind, the one failure that must not become
//    one, whether it was the program at all, and the last line it prints.

import { realpathSync } from "node:fs";

import { parseArgs } from "./args.ts";
import { NmtsError, NotBuiltYetError, UNKNOWN_FAILURE_EXIT } from "./errors.ts";
import { DISCORD_HELP_URL } from "./product.ts";

/** The exit code a failure asks for, or the generic one. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof NmtsError) return error.exitCode;
  return UNKNOWN_FAILURE_EXIT;
}

/** The last line of a failure a person could be stuck on (owner 2026-11-07 · E2, E3). */
export const STUCK_LINE =
  `Stuck? Ask in the NMTS Discord: ${DISCORD_HELP_URL} (the developer answers in English and Korean)`;

/**
 * What follows the rendered failure on stderr: {@link STUCK_LINE} and a newline, or nothing.
 *
 * ⛔ NOT UNDER THE CALLER'S OWN INPUT. A mistyped command or option, a key in the wrong shape (2),
 *    no key on this machine (3), an agreement still to give (5), a cancel (130) and an announced
 *    but unbuilt command each name the next keystroke; "stuck?" would be the wrong sentence there.
 *    What is left is 1 (something went wrong) and 4 (it could not be done), and unknown failures.
 * ⛔ NOT IN A MODE THAT PRINTS JSON (`--json`, `mcp`): whatever reads that output parses it, and a
 *    sentence is not part of the contract. A command line that cannot be read is a usage error.
 * ⛔ `renderError` STAYS AS IT WAS: the MCP server returns its text to an agent as the tool result.
 */
export function stuckLineFor(error: unknown, argv: readonly string[]): string {
  if (error instanceof NotBuiltYetError) return "";
  const code = exitCodeFor(error);
  if (code !== 1 && code !== 4) return "";
  try {
    const args = parseArgs(argv);
    if (args.json || args.command === "mcp") return "";
  } catch {
    return "";
  }
  return `${STUCK_LINE}\n`;
}

/**
 * Stop a closed pipe from becoming a crash.
 *
 * ⛔ `nmts ls | head` IS AN ORDINARY THING TO DO, and without this it prints a ten-line stack
 *    trace instead of the answer. `head` closes the pipe once it has its lines; the next write
 *    raises EPIPE, and Node turns an unhandled stream error into a fatal one. Every shell tool is
 *    expected to end quietly there — that is what SIGPIPE does for programs that do not intercept
 *    it — and an agent piping this into anything would otherwise read a crash and conclude the
 *    tool is broken.
 *
 * ⚠ ONLY EPIPE. A write that fails for any other reason is still a real failure and still throws;
 *   swallowing all stream errors would hide a full disk behind silence.
 */
export function endQuietlyOnClosedPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        process.exitCode = 0;
        return;
      }
      throw error;
    });
  }
}

/**
 * Is the module at `moduleFilename` the program, or is something importing it?
 *
 * ⛔ THE FILENAME IS PASSED IN AND NOT READ HERE. `import.meta.filename` inside this module
 *    would name THIS file, which is never the program; the caller's own is the question.
 *
 * ⛔ THE COMPARISON IS BETWEEN REAL PATHS, AND THAT IS THE WHOLE POINT. `npm install -g` does not
 *    copy the command onto your PATH — it puts a SYMLINK there, pointing at `dist/main.js` inside
 *    the installed package. Node then loads the module by its real
 *    path, so the module's own name is `.../dist/main.js` while `process.argv[1]` is
 *    `.../bin/nmts`. Comparing those two directly is never true for an installed command: `nmts --version` printed NOTHING and exited 0, and
 *    so did every other command. The whole tool did nothing at all, silently, and only when
 *    installed — which is the one way a person who is not us runs it.
 *
 * ⚠ `realpathSync` THROWS on a path that is not there. `process.argv[1]` normally exists, but a
 *   caller is free to hand Node something else, and a crash before the first line of output would
 *   be a worse answer than not running. Not resolving is treated as "not the program", which is
 *   the same answer this was giving before symlinks were considered at all.
 */
export function invokedDirectly(moduleFilename: string): boolean {
  const invokedAs = process.argv[1];
  if (invokedAs === undefined) return false;
  if (invokedAs === moduleFilename) return true;
  try {
    return realpathSync(invokedAs) === moduleFilename;
  } catch {
    return false;
  }
}

/**
 * Commands the version notice stays out of.
 *
 * ⛔ `update` BECAUSE IT IS THE NOTICE'S OWN SUBJECT — it has just said more about versions than
 *    one line could, and repeating a shorter version of it underneath would be noise.
 * ⛔ `mcp` BECAUSE IT DOES NOT END. It is a server on a pipe, and its stderr is read by whatever
 *    started it; a line arriving there whenever the process happens to stop is not a notice, it is
 *    an unexplained log entry.
 */
const NO_NOTICE: readonly string[] = ["update", "mcp"];

/**
 * Say so if a newer release is already known about, and refresh what is known for next time.
 *
 * ⛔ AFTER THE COMMAND, NOT BEFORE IT. Whatever was asked for has already been printed and the
 *    exit code is already decided; nothing here can change either. ⛔ AND ONLY FROM `main`: the
 *    tests drive `run` directly, so no test and no embedded caller ever reaches a network.
 */
export async function noteUpdateAfter(argv: readonly string[], version: string): Promise<void> {
  let command: string | null;
  try {
    command = parseArgs(argv).command;
  } catch {
    // A command line this could not read is one that failed above. Nothing to add to it.
    return;
  }
  if (command !== null && NO_NOTICE.includes(command)) return;
  // ⛔ THE SWITCH IS NOT CHECKED HERE AS WELL. `noteUpdate` reads it, and reading it twice would
  //    put one rule in two files — the shape that ends with one of them changing. There is nothing
  //    to save by checking early: the module holding the switch is the module being loaded.
  const { noteUpdate } = await import("./update-check.ts");
  await noteUpdate({ running: version });
}
