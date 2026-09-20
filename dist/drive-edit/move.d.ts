import { type ListEditInput } from "../manifest-write.ts";
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
