import { type ListEditInput } from "../manifest-write.ts";
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
