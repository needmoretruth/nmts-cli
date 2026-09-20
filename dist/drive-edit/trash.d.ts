import { type ListEditInput } from "../manifest-write.ts";
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
