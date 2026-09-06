/** What to do with one name that is already in use. */
export type ConflictChoice = "rename" | "overwrite";
/** One file whose desired name is already taken. */
export interface Conflict {
    /** Index into the batch handed to `findConflicts`, so the caller can match its own record. */
    readonly at: number;
    /** The name that is already in use. */
    readonly name: string;
    /** The folder it collides in — null is the root. */
    readonly parentId: string | null;
}
/** A conflict as it is put to whoever answers, with the answer already worked out for one branch. */
export interface Asked extends Conflict {
    /**
     * The name renaming would actually produce, at this point in the batch.
     *
     * ⛔ THE NAME, NOT "A NUMBER GETS ADDED". A screen that cannot say what the file will be called
     *    is asking somebody to choose between one known outcome and one unknown one. And it has to
     *    come from this walk rather than be guessed alongside it, or the second of three collisions
     *    is shown `(2)` and stored as `(3)`.
     */
    readonly renamedTo: string;
    /** How many conflicts are still to come after this one. 0 means this is the last. */
    readonly remaining: number;
}
/** One file on its way in, as much of it as this file needs. */
export interface Incoming {
    readonly name: string;
    readonly parentId: string | null;
}
/**
 * Which of these collide, in batch order.
 *
 * ⛔ THE TAKEN SET GROWS AS THIS WALKS. Two files called `report.pdf` in one drop collide with each
 *    other, not only with the drive — and a caller that asked only about the drive would give both
 *    the same name. So a name that has been handed out here counts as taken from then on, and the
 *    second one is reported as a conflict too.
 */
export declare function findConflicts(batch: readonly Incoming[], takenIn: (parentId: string | null) => ReadonlySet<string>): Conflict[];
/** What one file ended up as, after the choices were applied. */
export interface Settled {
    /** The name it will be stored under. */
    readonly name: string;
    readonly parentId: string | null;
    /**
     * The name it replaces in that folder, when the choice was to overwrite.
     *
     * ⚠ The NAME, not an id: this file does not know the drive's identifiers, and the caller that
     *   does is the one that has to find and destroy the old record.
     */
    readonly replaces?: string;
}
/**
 * Apply the choices and hand back what each file becomes.
 *
 * `choiceFor` is asked only about names that actually collide, one at a time and in batch order, so
 * a screen can put the question to a person and this walk waits. Anything it is not asked about
 * keeps its name. A batch answer ("do this for all") is the caller returning the same value from
 * then on without asking again — this file does not need to know that happened.
 *
 * ⛔ A RENAME CONSUMES THE NAME IT WAS GIVEN, an overwrite does not. Two files called `report.pdf`
 *    both overwriting would otherwise be two writes to one name — the second wins and the first is
 *    lost with nothing said. So the second one is renamed regardless of the choice, and the caller
 *    can see that because the name it gets back is not the name it asked for.
 */
export declare function settle(batch: readonly Incoming[], takenIn: (parentId: string | null) => ReadonlySet<string>, choiceFor: (conflict: Asked) => ConflictChoice | Promise<ConflictChoice>, 
/**
 * Can the thing holding this name be replaced at all?
 *
 * ⛔ A FOLDER CAN HOLD THE NAME. Offering "overwrite" then would offer to delete a folder and
 *    everything under it in order to store one file, from a dialog that names a file. Nothing
 *    asks; those are renamed, which is what happened before anything was asked at all.
 * ⚠ Left out means everything is replaceable, which is right for callers whose names are all
 *   files (the S3 gateway has no folders).
 */
overwritable?: (conflict: Conflict) => boolean): Promise<Settled[]>;
