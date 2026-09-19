import { NmtsError } from "./errors.ts";
import { type ListEditInput } from "./manifest-write.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/**
 * What went wrong, in a word a program can branch on.
 *
 * ⚠ FIVE, AND THEY ARE ABOUT THE LIST. A server refusal arrives as `ServerError` with the server's
 *   own code, and a lost compare-and-swap that never settles arrives as a plain `NmtsError`;
 *   neither is a decision this file made.
 */
export type DriveEditCode = 
/** No entry at that path — or a path that names two, which is the same "which one?" */
"NOT_FOUND"
/** Something else in that folder already answers to that name. */
 | "NAME_TAKEN"
/** The name itself cannot be used: empty, `.`, `..`, or a path pretending to be a name. */
 | "BAD_NAME"
/** A restore was asked for something that is not in the trash, or not in it on its own account. */
 | "NOT_IN_TRASH"
/** A folder was asked to move inside itself. */
 | "INTO_ITSELF";
/** A refusal about the list, with the sentence a person reads and the word a program reads. */
export declare class DriveEditError extends NmtsError {
    readonly code: DriveEditCode;
    constructor(code: DriveEditCode, message: string, options?: {
        exitCode?: number;
        nextStep?: string | null;
    });
}
/**
 * A new name is a name and not a path.
 *
 * ⛔ REFUSED RATHER THAN SPLIT. A name with a `/` in it is somebody asking for a move while typing
 *    a rename, and quietly doing the move would put the file somewhere they did not look.
 */
export declare function requireNewName(name: string): string;
/**
 * Make a folder path, and every folder above it that is missing, for an account already opened.
 *
 * ⛔ THE RULES BELOW ARE THE ONES A SECOND COPY WOULD GET SUBTLY WRONG: a folder that is already
 *    there IS the folder asked for (never a numbered one), the decision is taken inside each
 *    attempt so a lost race cannot make two, and what was made before a failure is named rather
 *    than silently kept.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience. A folder costs
 *   nothing, holds nothing and can be moved to the trash, so the failure mode of creating one too
 *   many is a tidy-up; the failure mode of refusing is a caller that has to discover the tree one
 *   call at a time. Every folder made is named in the result, so it is never a surprise.
 */
export declare function ensureFolderPath(input: ListEditInput, wanted: string): Promise<{
    parentId: string | null;
    made: string[];
}>;
/** What making a folder did. `made` is empty when every folder in the path was already there. */
export interface MadeFolder {
    /** The path as the drive spells it — no leading slash, no trailing one. */
    path: string;
    /** The folder at the end of the path. Null only for the top of the drive, which is never made. */
    parentId: string | null;
    /** The folders this call actually made, outermost first. */
    made: string[];
}
/** Make one folder path. A path that is already there is a success with nothing made. */
export declare function makeFolder(input: ListEditInput, path: string): Promise<MadeFolder>;
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
export declare function moveEntries(input: ListEditInput, paths: readonly string[], destination: string): Promise<MoveOutcome>;
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
export declare function renameEntry(input: ListEditInput, path: string, name: string): Promise<RenameOutcome>;
/**
 * What one run of the trash did — and, in this order, exactly what `nmts rm --json` prints.
 *
 * ⛔ THE ORDER OF THESE FIELDS IS THE COMMAND'S JSON. The command hands this object straight to
 *    `JSON.stringify`, so a field added in the middle changes what an agent reading that output
 *    sees. Add at the end, or not at all.
 */
export interface TrashOutcome {
    /** The paths acted on. Empty when everything named was already where it was asked to be. */
    paths: string[];
    /** Their ids, in the same order. */
    ids: string[];
    /** How many server rows were moved. A folder has none of its own; its files have one each. */
    files: number;
    /** Named, and nothing written for them: already out of the trash, or covered by a named folder. */
    skipped: string[];
    changed: boolean;
    reappliedAfterConflict: boolean;
    seq: number;
}
export interface TrashEditOptions {
    /**
     * Refuse what the command-line tool names and carries on with.
     *
     * ⛔ OFF FOR THE COMMANDS AND ON FOR A LIBRARY, and the difference is who is reading. A person
     *    who typed `nmts restore a.txt b.txt` and had already restored `a.txt` wants `b.txt` back and
     *    a line saying the first was not in the trash; a program calling `restore` wants to know that
     *    what it asked for was not what it got, and the only way it learns that is a refusal.
     *
     * It adds two: a path that is not in the trash (`NOT_IN_TRASH`) and a restore whose old name has
     * been taken since (`NAME_TAKEN`).
     */
    strict?: boolean;
}
/**
 * Move things to the trash, or bring them back.
 *
 * ⛔ NEITHER HALF DESTROYS ANYTHING. `rm` moves everything it is given to the trash, where it stays
 *    restorable for thirty days; the endpoint that erases a stored row for good is closed to an API
 *    key and stays closed, so nothing here can reach it.
 *
 * ⛔ THE SERVER ROW GOES FIRST, AND "ALREADY DONE" COUNTS AS DONE. A trashed item's bytes cannot be
 *    fetched, so the state to avoid above all others is a list that shows a file as live when the
 *    server has already trashed it: the person sees it, asks for it, and is told it does not exist.
 *    Writing the list only after the server agreed means a failed server call leaves the drive
 *    exactly as it was — the state a caller can act on.
 *
 * ⛔ AND ONE PATH THAT WILL NOT RESOLVE REFUSES THE WHOLE RUN, before a single server row is
 *    touched. Trashing four of the five things somebody named and answering success is worse than
 *    trashing none: the run reads as done, and finding the odd one out means diffing the drive.
 */
export declare function trashPaths(input: ListEditInput, verb: "rm" | "restore", paths: readonly string[], options?: TrashEditOptions): Promise<TrashOutcome>;
/**
 * Every file at or under one entry.
 *
 * ⚠ Trashed descendants are INCLUDED HERE, and the CALLER filters. Somebody who trashed one file
 *   last week and then trashes its folder expects the folder to be gone from the server too — so
 *   `rm` takes this set whole. `restore` cannot: see the note at the call site.
 */
export declare function filesUnder(entries: readonly ManifestEntry[], rootId: string): ManifestEntry[];
