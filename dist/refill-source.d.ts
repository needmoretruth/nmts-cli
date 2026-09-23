import { type ListEditInput } from "./manifest-write.ts";
import type { Network } from "./network.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/** The file a re-upload is built from, and exactly where the new one goes. */
export interface DriveOriginal {
    /** The entry as the list holds it — the id that goes to the trash, and the key that opens it. */
    entry: ManifestEntry;
    /** The name the new file takes: the old one's, because this replaces it in place. */
    name: string;
    parentId: string | null;
    /**
     * The folder the new file goes in, spelled as a path.
     *
     * ⚠ IT IS PART OF THE RESERVATION KEY, so it has to be the same string on a second attempt at
     *   the same re-upload. Built from the list rather than from what somebody typed, which is what
     *   makes it stable: `--from ./docs/a.txt` and `--from docs/a.txt` are one file and one key.
     */
    destination: string;
}
/**
 * The live file a drive path names, with the place the replacement goes.
 *
 * ⛔ A FOLDER, A TRASHED FILE AND A FILE WITH NO KEY ARE ALL REFUSED HERE, before anything is
 *    priced. Each one would fail later, after a price had been quoted and possibly after money had
 *    moved, and the third would fail in the worst place of all: the download.
 */
export declare function findOriginal(entries: readonly ManifestEntry[], path: string): DriveOriginal;
/** Where a downloaded plaintext waits while it is being sealed again. */
export interface Scratch {
    localPath: string;
    /** Remove it. Safe to call twice, and called on every path out. */
    remove: () => void;
}
/**
 * Read one file out of the account and leave it on this machine, checked.
 *
 * ⛔ THE SAME READ `nmts get` MAKES, including the whole-file hash. A re-upload that sealed bytes
 *    the download had not proved would replace a good file with a corrupt one and put the good one
 *    in the trash — the one outcome this command must never produce.
 */
export declare function downloadForRefill(input: {
    server: string;
    apiKey: string;
    code: string;
    network: Network;
    original: DriveOriginal;
}): Promise<Scratch>;
/**
 * Give the new file the old one's name and put the old one in the trash — after the upload, in one
 * write.
 *
 * ⛔ WHY IT IS A SECOND WRITE AND NOT AN OVERWRITE ON THE COMMIT. `collision.ts` refuses to let a
 *    per-run answer of "overwrite" take effect while this machine is in the default mode, on
 *    purpose: a program passing a flag must not be able to destroy a file. That rule is not worked
 *    around here. The upload lands as an ordinary addition — numbered beside the original if the
 *    machine renames — and only then, with the paid-for bytes safely in the list, is the name moved
 *    across and the original trashed. A person named the file they were replacing; nothing here
 *    decides that for anybody.
 *
 * ⛔ AND THE ORDER IS THE ONE THE WHOLE TOOL KEEPS: the new file is committed first, so a failure
 *    anywhere in this step leaves both files in the drive rather than neither. Running the same
 *    command again is not the repair for that — the file is already there under a numbered name —
 *    so what a failure here costs is a rename somebody does by hand, never bytes.
 *
 * ⚠ IT IS DECIDED AGAIN ON EVERY ATTEMPT of the compare-and-swap, which is what makes it safe to
 *   replay: a list where another device already trashed the original, or where this run's own
 *   earlier attempt already renamed the new file, produces no intent for that half.
 */
export declare function settleRefill(input: ListEditInput, original: DriveOriginal, newItemId: string): Promise<number>;
