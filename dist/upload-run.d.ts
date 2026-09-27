import { type Reservation } from "./upload-store.ts";
import { type PaidPart } from "./upload-wire.ts";
/** What a refusal over another run's records is known by, for a program to branch on. */
export declare const UPLOAD_CONFLICT = "UPLOAD_CONFLICT";
/** A name for one upload of a file. Random: it says nothing about the file or the account. */
export declare function newRunId(): string;
/**
 * The run this file's records belong to, or a new one when none of them names one.
 *
 * ⚠ A record an earlier version wrote names none. Its own key stays the one that version used
 *   (`runIdField`); the new id is only for the parts this run is the first to write down.
 */
export declare function runIdFor(fileKey: string, parts: number): Promise<string>;
/**
 * The run id a part's record is written with: the one it already has, or this upload's.
 *
 * ⛔ A RECORD KEEPS WHAT IT WAS WRITTEN WITH, including nothing. Its reservation is filed under the
 *    key it was made with; giving an earlier version's record a run id now would ask the server
 *    under a key it has never seen and buy the storage a second time.
 */
export declare function runIdField(existing: Reservation | null, runId: string): {
    runId?: string;
};
/**
 * Run `body` once every earlier run of the same file in this process has finished.
 *
 * ⚠ WAITING, NOT REFUSING. Inside one process the first run is known to be alive, so the honest
 *   answer to a second one is "after it": it then finds a finished upload's records and answers
 *   the same file, or finds none and starts an upload of its own.
 */
export declare function oneUploadAtATime<T>(fileKey: string, body: () => Promise<T>): Promise<T>;
/**
 * Refuse a part record that another sealing of this file wrote.
 *
 * ⛔ THE WRAPPED FILE KEY SAYS WHICH SEALING A RECORD BELONGS TO. It is sealed afresh by every
 *    upload that starts from nothing and carried unchanged by every resume, so a record whose key
 *    is not this run's was written by another run — and its bytes open under a key this file's
 *    list entry will not hold.
 */
export declare function refuseOtherSealing(existing: Reservation | null, input: {
    runId: string;
    entry: {
        dekWrapped: string;
    };
}): void;
/**
 * The last look before the commit: every part is still written down as THIS run bought it.
 *
 * ⛔ THE READ AT THE START OF A PART IS NOT ENOUGH ACROSS PROCESSES. Another run can write its own
 *    record over one of these between that read and this commit; the commit names what this run
 *    paid for, so a record that no longer agrees means two sealings are interleaved, and a file
 *    made of both would not open.
 */
export declare function confirmParts(fileKey: string, paid: readonly PaidPart[], entry: {
    dekWrapped: string;
}): Promise<void>;
/**
 * Forget a finished upload's records: the parts from the last to the first, then the file's own.
 *
 * ⛔ THE ORDER IS WHAT A RUN THAT STARTS IN THE MIDDLE OF IT CAN READ. A live upload's parts are
 *    always written down from the first, so what is left at any moment is a finished upload the
 *    next run recognises — a committed file with the first of its parts still named — or a file
 *    record alone, which names another run and is passed over. Forgetting the file's record first,
 *    or the parts from the front, left the tail of a finished upload looking like the start of a
 *    live one, which the next run would resume into keys the server has already settled.
 */
export declare function forgetUpload(fileKey: string, parts: number): Promise<void>;
/**
 * Forget records that cannot belong to a live upload: a part written down after one that is not,
 * or a file's record with none of its parts.
 *
 * ⛔ WHY THOSE SHAPES MEAN "LEFT OVER". A live upload writes its parts down from the first, one at a
 *    time and each before its money moves; it writes the file's record only once every part is
 *    written down; and nothing removes any of them until the file is committed AND listed. So a gap
 *    in front of a part, or a file record alone, is a finished upload whose forgetting stopped half
 *    way (or ran in the old order). Resuming the first would seal the missing part afresh under a
 *    key the server has already settled for other bytes; resuming the second would answer the old
 *    file for new storage.
 */
export declare function dropLeftovers(fileKey: string, parts: number): Promise<void>;
