import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { NmtsError } from "../errors.ts";
/** What this drive holds at a key, compared with what is arriving. */
export type SameFile = 
/** Nothing is at that key. */
"free"
/** Byte-for-byte what is already there. Nothing to upload. */
 | "same"
/** Something else is there. */
 | "differs"
/** Something is there and this drive has no recorded hash for it, so the question cannot be put. */
 | "unknown";
/**
 * Thrown when a key holds a DIFFERENT file. The gateway answers 409 rather than 500: the request
 * was well formed and the drive declined it, which is what that status is for.
 */
export declare class KeyConflict extends NmtsError {
    constructor(message: string);
}
/** True when a thrown value is that refusal, without importing the class into the protocol layer. */
export declare function isKeyConflict(error: unknown): boolean;
/** The SHA-256 of a file on this machine, read in pieces so a large one costs no memory. */
export declare function hashOfFile(path: string): Promise<Uint8Array>;
/**
 * Open the hash this drive recorded for a file, with the account's own key.
 *
 * `null` when the entry carries none — files stored before the field existed do not have one, and
 * that is a real state rather than an error. A hash that is present and will not open IS an error:
 * it means the file list was written by another account or altered, and answering "no hash" there
 * would quietly turn a tampered list into an upload.
 */
export declare function recordedHash(accountCode: string, contentHashCt: string | undefined): Promise<Uint8Array | null>;
/**
 * The whole question, for one key: what does this drive hold there, and is the file on disk it?
 *
 * ⛔ IT IS ONE FUNCTION SO THERE IS ONE ANSWER. Both ways of uploading — a single PUT, and pieces
 *    staged and joined — reach the drive through the same store, and this is what that store asks.
 *    Written at the two call sites instead, the two would differ the first time one of them
 *    changed, and the difference would show up only above whatever size the client switches at.
 *
 * ⚠ THE FILE IS HASHED ONLY WHEN THE KEY IS TAKEN. An upload onto a free key is the common case
 *   and pays nothing for this.
 */
export declare function verdictForKey(entries: readonly ManifestEntry[], key: string, accountCode: string, path: string): Promise<SameFile>;
/** The verdict, given what is on record and what arrived. */
export declare function compare(recorded: Uint8Array | null | undefined, arriving: Uint8Array): SameFile;
/**
 * What to tell a client whose upload was declined.
 *
 * ⛔ IT NAMES WHICH OF THE TWO HAPPENED. "There is already a file there" is the same sentence for a
 *    file that changed and for a file this drive cannot compare, and the two need different things
 *    from the person reading the log.
 */
export declare function refusalFor(verdict: "differs" | "unknown", key: string): KeyConflict;
