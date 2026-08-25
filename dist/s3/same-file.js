// Is the file arriving at this key the file already there?
//
// ⛔ WHY THE QUESTION IS ABOUT CONTENT AND NOT ABOUT NAMES. The gateway used to answer a taken key
//    with 409 on the strength of the name alone. A backup program's whole job is to send the same
//    names again, so every run failed on every file it had already stored — and a sync tool writes
//    a 409 down as a failure, which is the wrong word for "it is already there".
//
// ⛔ WHAT IS COMPARED IS THE PLAINTEXT'S SHA-256, AND THE STORED COPY OF IT IS SEALED. Every
//    upload already records one (`contentHashCt`, sealed under the account's data key), so nothing
//    about the format changes here. It is sealed rather than stored bare for a reason worth
//    repeating: a bare hash is the SAME NUMBER for everybody who holds that file, so a server
//    keeping them could match its users against a published list of hashes. Sealed, only the
//    account that wrote it can compare.
//
// ⛔ "REFUSE" MEANS THE UPLOAD, NOT THE REQUEST. Identical content is answered 200 with nothing
//    sent and nothing charged, because from the client's side the statement "that file is at that
//    key" is true. Only DIFFERENT content is a conflict.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { AAD, DERIVED, loadCrypto } from "../crypto.js";
import { objectsOf } from "./listing.js";
import { NmtsError } from "../errors.js";
/**
 * Thrown when a key holds a DIFFERENT file. The gateway answers 409 rather than 500: the request
 * was well formed and the drive declined it, which is what that status is for.
 */
export class KeyConflict extends NmtsError {
    constructor(message) {
        super(message);
        this.name = "KeyConflict";
    }
}
/** True when a thrown value is that refusal, without importing the class into the protocol layer. */
export function isKeyConflict(error) {
    return error instanceof Error && error.name === "KeyConflict";
}
/** The SHA-256 of a file on this machine, read in pieces so a large one costs no memory. */
export async function hashOfFile(path) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path))
        digest.update(chunk);
    return new Uint8Array(digest.digest());
}
/**
 * Open the hash this drive recorded for a file, with the account's own key.
 *
 * `null` when the entry carries none — files stored before the field existed do not have one, and
 * that is a real state rather than an error. A hash that is present and will not open IS an error:
 * it means the file list was written by another account or altered, and answering "no hash" there
 * would quietly turn a tampered list into an upload.
 */
export async function recordedHash(accountCode, contentHashCt) {
    if (contentHashCt === undefined || contentHashCt === "")
        return null;
    const crypt = await loadCrypto();
    const [from, to] = DERIVED.dataKey;
    const derived = crypt.kdf_derive(crypt.account_code_parse(accountCode));
    const dataKey = derived.slice(from, to);
    derived.fill(0);
    try {
        return crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.contentHash), Buffer.from(contentHashCt, "base64url"));
    }
    catch {
        throw new NmtsError("The recorded hash of the file at that key did not open with this account's key.", {
            nextStep: "Either the file list belongs to another account, or it has been altered.",
        });
    }
    finally {
        dataKey.fill(0);
    }
}
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
export async function verdictForKey(entries, key, accountCode, path) {
    const standing = objectsOf(entries).find((o) => o.key === key);
    if (standing === undefined)
        return "free";
    return compare(await recordedHash(accountCode, standing.entry.contentHashCt), await hashOfFile(path));
}
/** The verdict, given what is on record and what arrived. */
export function compare(recorded, arriving) {
    if (recorded === undefined)
        return "free";
    if (recorded === null)
        return "unknown";
    if (recorded.length !== arriving.length)
        return "differs";
    for (let i = 0; i < recorded.length; i += 1) {
        if (recorded[i] !== arriving[i])
            return "differs";
    }
    return "same";
}
/**
 * What to tell a client whose upload was declined.
 *
 * ⛔ IT NAMES WHICH OF THE TWO HAPPENED. "There is already a file there" is the same sentence for a
 *    file that changed and for a file this drive cannot compare, and the two need different things
 *    from the person reading the log.
 */
export function refusalFor(verdict, key) {
    return new KeyConflict(verdict === "differs"
        ? `A different file is already at ${key}, and this drive does not replace files. Delete it ` +
            "first — a delete puts it in the trash, where it stays recoverable for thirty days."
        : `A file is already at ${key} and this drive has no recorded hash for it, so it cannot tell ` +
            "whether yours is the same one. Files stored before hashes were recorded are in this state. " +
            "Delete it first if you mean to replace it.");
}
