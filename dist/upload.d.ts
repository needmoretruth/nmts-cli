import { type Reservation } from "./upload-store.ts";
import { type PaidPart, type UploadInput, type UploadResult } from "./upload-wire.ts";
export * from "./upload-wire.ts";
/**
 * Buy storage for ONE PART, put its bytes on the network, and stop there.
 *
 * ⛔ IT DOES NOT MAKE A FILE. Committing is one act for the whole file — `commitItem` names every
 *    part at once — and a part that returns from here is bought, filled and certified storage that
 *    nothing in the account can see yet. Splitting it this way is what lets a file be larger than
 *    memory: the parts are bought one at a time, each written down before its own money moves.
 *
 * ⛔ IT DOES NOT WRITE THE FILE LIST either. That is the caller's step, and it must happen before
 *    the records are cleared — a committed file the list does not name is invisible and, to the
 *    person, indistinguishable from one that never uploaded.
 */
export declare function buyAndPushPart(input: UploadInput): Promise<PaidPart>;
/** What the file list must record about this upload. Always from the record, never from a run. */
export declare function entryOf(record: Reservation): UploadResult["entry"];
