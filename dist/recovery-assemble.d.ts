import { type BuiltRecoveryList } from "./recovery-build.ts";
import { type Session } from "./session.ts";
export interface AssembleOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Ticks while the account is being read, so a large one does not look frozen. */
    onProgress?: ((loaded: number) => void) | undefined;
}
export interface AssembledRecoveryList {
    session: Session;
    /** base64url of the 32-byte account proof. ⛔ Held for this run's requests and nothing else. */
    proof: string;
    built: BuiltRecoveryList;
    /** This list's own version number. */
    seq: number;
    /** RFC3339, stamped before the account was read. What the server is told. */
    capturedAt: string;
    /** The `.nmtsmap` document and the name to offer it under. */
    file: {
        filename: string;
        content: string;
    };
}
export declare function assembleRecoveryList(options?: AssembleOptions): Promise<AssembledRecoveryList>;
/**
 * Tell the server a list was written, and what number it carries.
 *
 * ⛔ THE FILE FIRST, THE RECORD SECOND — so this takes the path that already exists. The record is
 *    what makes an account screen say "your list is up to date"; saying that before the file
 *    exists would be a claim about something that may never have been written.
 *
 * ⛔ `kind: "local"` AND NO BLOB ID. This tool keeps the list on the person's own disk and writes
 *    no copy to the storage network, and the server refuses a blob id alongside `local` for
 *    exactly that reason: a recorded address nothing was written to would let a screen advertise
 *    a copy that does not exist.
 *
 * ⛔ THE ATTEMPT IS REMEMBERED WHETHER OR NOT IT LANDS. See `recovery-seq.ts`: a number the server
 *    refused must not be the number the next run offers again, or the refusal repeats for ever.
 */
export declare function recordRecoveryList(assembled: AssembledRecoveryList, destination: string): Promise<void>;
