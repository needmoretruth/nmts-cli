import { openSession } from "../session.ts";
export interface PushOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where the tree goes in the drive. The top of the drive when absent. */
    to?: string | undefined;
    /** Say what it would cost and stop. Nothing is sealed, sent, or charged. */
    dryRun?: boolean;
    /** Include entries whose name begins with a dot. */
    hidden?: boolean;
    partSize?: string | number | undefined;
    /** What THIS run does about a name already in use. Absent = this machine's setting. */
    onCollision?: string | undefined;
    /** Credits EACH file in this run sets aside as a deposit, 0 to 64. Absent = the account's own. */
    deposit?: string | number | undefined;
    /** Who pays: `credits` (absent) or `wallet`. See `put.ts`. */
    pay?: string | undefined;
    /** `--pay wallet`: how many epochs to buy for every file. */
    epochs?: string | number | undefined;
    /** ⛔ Refused here: a held resource holds ONE blob, and a directory is many. */
    storage?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /**
     * Send ONE file. The real one seals, buys, uploads and records it.
     *
     * ⛔ A SEAM, NOT A CONVENIENCE. What is worth testing here is the decisions AROUND the upload —
     *    which files are skipped, what is priced, and what a run says after it stops half way — and
     *    every one of those needs a failure that costs no money to produce.
     */
    send?: (one: PlannedFile, parentId: string | null) => Promise<string>;
}
/** One local file, and where it goes in the drive. */
export interface PlannedFile {
    /** Absolute path on this machine. */
    local: string;
    /** Folder path inside the drive. */
    folder: string;
    name: string;
    size: number;
}
export declare function push(target: string | undefined, options?: PushOptions): Promise<number>;
/** The folder id for a drive path, made if it is not there yet. Remembered for the next file. */
export declare function folderFor(session: Awaited<ReturnType<typeof openSession>>, known: Map<string, string | null>, folder: string): Promise<string | null>;
export { walk as filesUnderDirectory };
/** Every file under a local directory, with the drive folder each one belongs in. */
declare function walk(dir: string, driveFolder: string, hidden: boolean): PlannedFile[];
