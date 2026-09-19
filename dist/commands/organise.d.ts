export interface OrganiseOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
/**
 * Make a folder, and any folder above it that is missing.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience — the reason is
 *   beside the code that does it, in `drive-edit.ts`. Every folder made is named in the output, so
 *   it is never a surprise.
 */
export declare function mkdir(path: string | undefined, options?: OrganiseOptions): Promise<number>;
/**
 * Move things into a folder. Every operand but the last is something to move; the last is where
 * they go, and an empty one means the top of the drive.
 *
 * ⛔ ONE WRITE FOR THE WHOLE RUN, however many things are named, and every guard is re-decided
 *    inside the attempt. Both reasons are in `drive-edit.ts`, beside the loop that keeps them.
 */
export declare function mv(operands: readonly string[], options?: OrganiseOptions): Promise<number>;
/** Give one thing a new name. The path stays the same otherwise. */
export declare function rename(path: string | undefined, name: string | undefined, options?: OrganiseOptions): Promise<number>;
