import { openSession } from "../session.ts";
export interface OrganiseOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
/**
 * Make a folder, and any folder above it that is missing.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience. A folder costs
 *   nothing, holds nothing and can be moved to the trash, so the failure mode of creating one too
 *   many is a tidy-up; the failure mode of refusing is an agent that has to discover the tree one
 *   command at a time. Every folder made is named in the output, so it is never a surprise.
 */
/**
 * Make a folder path, and every folder above it that is missing, under an OPEN session.
 *
 * ⛔ SPLIT OUT SO AN UPLOAD OF A WHOLE DIRECTORY CAN USE IT. The rules below are the ones a second
 *    copy would get subtly wrong: a folder that is already there IS the folder asked for (never a
 *    numbered one), the decision is taken inside each attempt so a lost race cannot make two, and
 *    what was made before a failure is named rather than silently kept.
 */
export declare function ensureFolderPath(session: Awaited<ReturnType<typeof openSession>>, wanted: string): Promise<{
    parentId: string | null;
    made: string[];
}>;
export declare function mkdir(path: string | undefined, options?: OrganiseOptions): Promise<number>;
/**
 * Move things into a folder. Every operand but the last is something to move; the last is where
 * they go, and an empty one means the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named. The list is rewritten whole on
 *    every save, so a second thing costs nothing extra — while a second WRITE is a second chance
 *    to lose the compare-and-swap, and losing it half way through a run leaves some things moved
 *    and some not, which is a state the caller cannot tell apart from the one it asked for.
 *
 * ⛔ AND THE NAME CHECK RUNS AGAINST WHAT THIS RUN HAS ALREADY MOVED, not against the list as it
 *    was read. Two files called `notes.txt` in two folders, moved into one folder by one command,
 *    would otherwise both be written — two entries at one path, which no command in this tool can
 *    address afterwards: every one of them answers "names 2 things in this account". So the loop
 *    folds each move onto a working copy and asks the working copy the next question.
 */
export declare function mv(operands: readonly string[], options?: OrganiseOptions): Promise<number>;
/** Give one thing a new name. The path stays the same otherwise. */
export declare function rename(path: string | undefined, name: string | undefined, options?: OrganiseOptions): Promise<number>;
