// `nmts rm` and `nmts restore` — the two halves of the trash.
//
// ⛔ WHAT THEY DO IS IN `drive-edit.ts`; WHAT IS HERE IS THE TERMINAL. The server rows, the list
//    write and every refusal about the list moved out the day the SDK needed the same two verbs
//    without one — and the order of the two (row first, list second) is the rule a second copy
//    would be most likely to get backwards.
//
// ⛔ NEITHER OF THESE DESTROYS ANYTHING. `rm` moves everything it is given to the trash, where it
//    stays restorable for thirty days; the endpoint that erases a stored row for good is closed to
//    an API key and stays closed, so no command here can reach it.
//
// ⛔ BOTH TAKE MANY PATHS AND WRITE THE LIST ONCE. Everything named is trashed together or
//    nothing is: a run that wrote once per path would be one lost compare-and-swap away from a
//    drive with half of the deletion in it, and the message would still say the whole run had
//    happened. The server rows still go one at a time — there is no batch endpoint — which is
//    why a run that stops half way names how far it got.
//
// ⚠ ONE VERB IN THIS TOOL DOES HAVE NO UNDO, AND IT IS DELIBERATELY NOT THESE TWO. `nmts sweep`
//   drops list entries whose thirty days have already run out, which destroys this account's copy
//   of the key for files the server has already destroyed its own copy of. It is a separate
//   command, it stops for an answer on every run rather than once per machine, and it can never
//   touch anything still inside the window these two work on. The sentence that used to sit here
//   said no verb without an undo would ever live in this tool; that stopped being true the day
//   the sweep arrived, and a header that goes on describing the world before a change is the way
//   the next reader is misled.

import { trashPaths } from "../drive-edit.ts";
import { NmtsError } from "../errors.ts";
import { openSession } from "../session.ts";

export interface TrashOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

export async function rm(paths: readonly string[], options: TrashOptions = {}): Promise<number> {
  return run("rm", paths, options);
}

export async function restore(paths: readonly string[], options: TrashOptions = {}): Promise<number> {
  return run("restore", paths, options);
}

async function run(verb: "rm" | "restore", paths: readonly string[], options: TrashOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (paths.length === 0) {
    throw new NmtsError(`\`nmts ${verb}\` needs the path of at least one thing in the drive.`, {
      exitCode: 2,
      nextStep: `\`nmts ls${verb === "restore" ? " --all" : ""}\` prints the paths as this expects them.`,
    });
  }

  const session = await openSession(options);
  // ⛔ WITHOUT `strict`. A person gets a line saying what was already out of the trash and keeps
  //    the rest of their run; a program gets a refusal, because it cannot read the line. The
  //    difference is spelled once, where the option is declared.
  const outcome = await trashPaths(session, verb, paths);

  // ⚠ The outcome's own field order IS this output. Nothing is assembled here, so the two can
  //   never drift into saying different things about the same run.
  if (options.json) {
    say(JSON.stringify(outcome));
    return 0;
  }
  if (outcome.paths.length === 0) return nothingToDo(say, verb, outcome.skipped);

  const moved = outcome.files === 1 ? "1 file" : `${outcome.files} files`;
  const names = outcome.paths.map((s) => `"${s}"`).join(", ");
  say(
    verb === "rm"
      ? `Moved ${names} to the trash (${moved}). ${outcome.paths.length === 1 ? "It" : "They"} can be restored for 30 days.`
      : `Restored ${names} (${moved}).`,
  );
  if (outcome.skipped.length > 0) say(`  ${skippedLine(verb, outcome.skipped)}`);
  if (outcome.reappliedAfterConflict) {
    say(`  Another device wrote the file list first, so this was applied to that version.`);
  }
  return 0;
}

/** What was named but not acted on, in the words that say why. */
function skippedLine(verb: "rm" | "restore", skipped: readonly string[]): string {
  const names = skipped.map((s) => `"${s}"`).join(", ");
  return verb === "rm"
    ? `${names} is inside something else that was named, so it goes with it.`
    : `${names} was not in the trash.`;
}

/**
 * The run had nothing to do.
 *
 * ⚠ In practice this is the `restore` case — everything named was already out of the trash.
 *   `rm` reaches it only if every path it resolved was inside another path it resolved, which
 *   cannot happen while the outermost one is always kept.
 */
function nothingToDo(say: (line: string) => void, verb: "rm" | "restore", skipped: readonly string[]): number {
  const names = skipped.map((s) => `"${s}"`).join(", ");
  say(
    verb === "restore"
      ? `${names} ${skipped.length === 1 ? "is" : "are"} not in the trash. Nothing changed.`
      : `Nothing was left to move to the trash. Nothing changed.`,
  );
  return 0;
}
