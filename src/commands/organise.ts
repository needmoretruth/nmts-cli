// `nmts mkdir`, `nmts mv` and `nmts rename` — the three edits that touch no bytes.
//
// ⛔ WHAT THEY DO IS IN `drive-edit.ts`; WHAT IS HERE IS THE TERMINAL. The list editing moved out
//    the day the SDK needed the same three verbs without one — one implementation, two callers, so
//    "what does moving onto a taken name do" is answered in a single place.
//
// ⛔ NONE OF THESE ASKS THE SERVER TO CHANGE ANYTHING BUT THE SEALED LIST. A folder has no server
//    row at all, and a name and a parent live only inside the list — the server holds an id, a
//    size and a time, and was deliberately never given a place to put a name
//    (`PATCH /v1/items/{id}` was removed from the API for exactly that reason).
//    ⚠ They are not offline and they are not unobserved: each one reads the list and writes it
//      back, so the server sees a manifest write of a known size at a known moment. The sentence
//      that used to sit here said "invisible to us", which was never true (2026-08-23).
//
// ⛔ AND NONE OF THEM STOPS TO ASK. Renaming, moving and making a folder are reversible and cost
//    nothing, which is the whole test for whether this tool interrupts somebody. It does not.

import { makeFolder, moveEntries, renameEntry, requireNewName } from "../drive-edit.ts";
import { normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { openSession } from "../session.ts";

export interface OrganiseOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

const say_ = (line: string): void => void process.stdout.write(`${line}\n`);

/**
 * Make a folder, and any folder above it that is missing.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience — the reason is
 *   beside the code that does it, in `drive-edit.ts`. Every folder made is named in the output, so
 *   it is never a surprise.
 */
export async function mkdir(path: string | undefined, options: OrganiseOptions = {}): Promise<number> {
  const say = options.write ?? say_;
  const wanted = normalisePath(path ?? "");
  if (wanted === "") {
    throw new NmtsError("`nmts mkdir` needs the path of the folder to make.", { exitCode: 2 });
  }
  const session = await openSession(options);
  const { parentId, made } = await makeFolder(session, wanted);

  if (options.json) {
    say(JSON.stringify({ path: wanted, id: parentId, made }));
    return 0;
  }
  // ⛔ THE FOLDERS ARE NAMED, NOT COUNTED. "including 2 folder(s) above it" cannot disagree with
  //    what was written, so it could never have caught a helper quietly renaming one.
  if (made.length === 0) say(`"${wanted}" is already there. Nothing was made.`);
  else say(`Made ${made.map((m) => `"${m}"`).join(", ")}.`);
  return 0;
}

/**
 * Move things into a folder. Every operand but the last is something to move; the last is where
 * they go, and an empty one means the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named, and every guard is re-decided
 *    inside the attempt. Both reasons are in `drive-edit.ts`, beside the loop that keeps them.
 */
export async function mv(operands: readonly string[], options: OrganiseOptions = {}): Promise<number> {
  const say = options.write ?? say_;
  const destination = operands.at(-1);
  const paths = operands.slice(0, -1);
  if (destination === undefined || paths.length === 0) {
    throw new NmtsError("`nmts mv` needs what to move and where to put it.", {
      exitCode: 2,
      nextStep:
        `For example: nmts mv notes.txt archive   ·   nmts mv a.txt b.txt archive   ·   ` +
        `nmts mv archive/notes.txt /`,
    });
  }

  const session = await openSession(options);
  const outcome = await moveEntries(session, paths, destination);

  const shownDestination = normalisePath(destination);
  const where = shownDestination === "" ? "the top of the drive" : `"${shownDestination}"`;
  if (options.json) {
    say(
      JSON.stringify({
        moved: outcome.moved.map((m) => ({ id: m.id, name: m.name, path: m.path })),
        already: outcome.already,
        parentId: outcome.parentId,
        changed: outcome.changed,
        reappliedAfterConflict: outcome.reappliedAfterConflict,
        seq: outcome.seq,
      }),
    );
    return 0;
  }
  // ⛔ THE THINGS ARE NAMED, NOT COUNTED. "2 things moved" cannot disagree with what was written,
  //    so it could never catch a run that moved something the caller did not name.
  const names = outcome.moved.map((m) => `"${m.name}"`).join(", ");
  say(
    outcome.moved.length > 0
      ? `Moved ${names} to ${where}.`
      : `Everything named is already in ${where}. Nothing was moved.`,
  );
  if (outcome.moved.length > 0 && outcome.already.length > 0) {
    say(`  ${outcome.already.map((n) => `"${n}"`).join(", ")} was already there.`);
  }
  if (outcome.changed && outcome.reappliedAfterConflict) {
    say(`  Another device wrote the file list first, so this was applied to that version.`);
  }
  return 0;
}

/** Give one thing a new name. The path stays the same otherwise. */
export async function rename(
  path: string | undefined,
  name: string | undefined,
  options: OrganiseOptions = {},
): Promise<number> {
  const say = options.write ?? say_;
  if (path === undefined || name === undefined || name.trim() === "") {
    throw new NmtsError("`nmts rename` needs what to rename and the new name.", {
      exitCode: 2,
      nextStep: `For example: nmts rename notes.txt "meeting notes.txt"`,
    });
  }
  // ⛔ ASKED HERE AS WELL AS INSIDE, AND IT IS THE SAME FUNCTION RATHER THAN A SECOND COPY. A name
  //    with a `/` in it is wrong about the ARGUMENT, so it is refused before a session is opened —
  //    otherwise a machine with no API key would be told about the key instead of about the name
  //    that was typed.
  requireNewName(name);

  const session = await openSession(options);
  const outcome = await renameEntry(session, path, name);
  return report(say, options, outcome.changed, outcome.reappliedAfterConflict, {
    text: outcome.changed
      ? `Renamed "${outcome.fromPath}" to "${name}".`
      : `"${outcome.fromPath}" is already called that.`,
    json: {
      id: outcome.id,
      from: outcome.from,
      to: name,
      changed: outcome.changed,
      reappliedAfterConflict: outcome.reappliedAfterConflict,
      seq: outcome.seq,
    },
  });
}

function report(
  say: (line: string) => void,
  options: OrganiseOptions,
  changed: boolean,
  conflicted: boolean,
  out: { text: string; json: Record<string, unknown> },
): number {
  if (options.json) {
    say(JSON.stringify(out.json));
    return 0;
  }
  say(out.text);
  if (changed && conflicted) {
    say(`  Another device wrote the file list first, so this was applied to that version.`);
  }
  return 0;
}
