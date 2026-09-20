// Moving things into a folder, and giving one thing a new name where it is.

import {
  buildIndex,
  entryAt,
  folderIdFor,
  fullPathOf,
  namesIn,
  normaliseName,
} from "../drive-paths.ts";
import { readFileList } from "../manifest.ts";
import { applyManyToList, applyToList, batchTargets, type ListEditInput } from "../manifest-write.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { applyIntent, type ManifestIntent } from "../shared/lib/drive/manifest-ops.ts";
import { DriveEditError, requireNewName, resolving } from "./errors.ts";
import { isUnder } from "./tree.ts";

/** One thing a move carried, with where it came from and where it landed. */
export interface MovedThing {
  id: string;
  /** Its name, which a move never changes. */
  name: string;
  /** Its full path before the move. */
  from: string;
  /** Its full path after, or null if another device took it out of the list meanwhile. */
  path: string | null;
}

/** What one run of moving did. */
export interface MoveOutcome {
  /** The things this run moved, in the order they were named. */
  moved: MovedThing[];
  /** The names that were already in the destination, so nothing was written for them. */
  already: string[];
  /** The destination folder id, or null for the top of the drive. */
  parentId: string | null;
  /** False when everything named was already there, so no list was written. */
  changed: boolean;
  /** True when the list was rebuilt because another device wrote first. */
  reappliedAfterConflict: boolean;
  /** The list version now current. */
  seq: number;
}

/**
 * Move things into a folder. An empty destination is the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named. The list is rewritten whole on
 *    every save, so a second thing costs nothing extra — while a second WRITE is a second chance
 *    to lose the compare-and-swap, and losing it half way through a run leaves some things moved
 *    and some not, which is a state the caller cannot tell apart from the one it asked for.
 *
 * ⛔ AND THE NAME CHECK RUNS AGAINST WHAT THIS RUN HAS ALREADY MOVED, not against the list as it
 *    was read. Two files called `notes.txt` in two folders, moved into one folder by one call,
 *    would otherwise both be written — two entries at one path, which nothing can address
 *    afterwards: every lookup answers "names 2 things in this account". So the loop folds each
 *    move onto a working copy and asks the working copy the next question.
 */
export async function moveEntries(
  input: ListEditInput,
  paths: readonly string[],
  destination: string,
): Promise<MoveOutcome> {
  const at = Date.now();
  let moved: { id: string; name: string; from: string }[] = [];
  let already: string[] = [];
  let parentId: string | null = null;
  // ⛔ EVERY GUARD RUNS INSIDE THE ATTEMPT, INCLUDING WHICH ENTRY EACH PATH NAMES. A lost
  //    compare-and-swap re-applies the intent to a list that changed underneath — and when the
  //    winner had just taken this name, the loser landed on top of it and produced two entries at
  //    one path. Meanwhile the caller was told the move had been made.
  const result = await applyManyToList(input, (now) => {
    const targets = resolving(() => batchTargets(now, paths, { nothingHappened: "Nothing was moved." }));
    const into = resolving(() => folderIdFor(destination, now, "Nothing was moved."));
    const index = buildIndex(now);
    const intents: ManifestIntent[] = [];
    const carried: { id: string; name: string; from: string }[] = [];
    const there: string[] = [];
    let working: readonly ManifestEntry[] = now;
    for (const target of targets) {
      if (into !== null && (into === target.id || isUnder(working, into, target.id))) {
        throw new DriveEditError("INTO_ITSELF", `A folder cannot be moved inside itself.`, {
          exitCode: 4,
          nextStep: "Nothing was moved.",
        });
      }
      if (into === target.parentId) {
        there.push(target.name);
        continue;
      }
      if (namesIn(working, into).has(normaliseName(target.name))) {
        throw new DriveEditError("NAME_TAKEN", `Something called "${target.name}" is already in that folder.`, {
          exitCode: 4,
          nextStep: `Nothing was moved. Rename it first: nmts rename "${target.name}" <new name>`,
        });
      }
      const intent: ManifestIntent = { op: "move", id: target.id, parentId: into, at };
      intents.push(intent);
      working = applyIntent(working, intent);
      carried.push({ id: target.id, name: target.name, from: fullPathOf(index, target) });
    }
    moved = carried;
    already = there;
    parentId = into;
    return intents;
  });

  // ⚠ Read off the list AS WRITTEN, not off the intents: an id another device took out of the list
  //   meanwhile has no path any more, and claiming one would name a place nothing is at.
  const after = buildIndex(result.entries);
  return {
    moved: moved.map((m) => {
      const live = result.entries.find((e) => e.id === m.id);
      return { id: m.id, name: m.name, from: m.from, path: live === undefined ? null : fullPathOf(after, live) };
    }),
    already,
    parentId,
    changed: result.changed,
    reappliedAfterConflict: result.reappliedAfterConflict,
    seq: result.seq,
  };
}

/** What renaming one thing did. */
export interface RenameOutcome {
  id: string;
  /** The name it had. */
  from: string;
  /** The full path it had, which is what a person recognises it by. */
  fromPath: string;
  /** The name it has now. */
  to: string;
  /** False when it was already called that, so no list was written. */
  changed: boolean;
  reappliedAfterConflict: boolean;
  seq: number;
}

/**
 * Give one thing a new name. The path stays the same otherwise.
 *
 * ⛔ REFUSED RATHER THAN NUMBERED, AND THE REFUSAL IS RE-DECIDED ON EVERY ATTEMPT. An upload picks
 *    `report (2).pdf` because nobody was watching; a rename is somebody choosing a name on purpose,
 *    and silently giving them a different one is how two files end up looking like a mistake nobody
 *    made. Checking once, before the write, was not enough: when another device took the name in
 *    between, the retry re-applied the old decision and produced two entries at one path, which
 *    nothing can address afterwards (2026-08-23).
 */
export async function renameEntry(
  input: ListEditInput,
  path: string,
  name: string,
): Promise<RenameOutcome> {
  requireNewName(name);
  const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
  const entries: readonly ManifestEntry[] = list.manifest?.entries ?? [];
  const target = resolving(() => entryAt(entries, path, { nothingHappened: "Nothing was renamed." }));

  const at = Date.now();
  const fromPath = fullPathOf(buildIndex(entries), target);
  const result = await applyToList(input, (now) => {
    const live = now.find((e) => e.id === target.id);
    if (live === undefined) return null;
    if (normaliseName(name) !== normaliseName(live.name) && namesIn(now, live.parentId).has(normaliseName(name))) {
      throw new DriveEditError("NAME_TAKEN", `Something called "${name}" is already in that folder.`, {
        exitCode: 4,
        nextStep: "Nothing was renamed.",
      });
    }
    return { op: "rename", id: target.id, name, at };
  });
  return {
    id: target.id,
    from: target.name,
    fromPath,
    to: name,
    changed: result.changed,
    reappliedAfterConflict: result.reappliedAfterConflict,
    seq: result.seq,
  };
}
