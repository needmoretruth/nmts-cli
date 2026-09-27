// The limits a gateway puts on what one client can make it hold, and the answers for going past them.
//
// ⛔ A GATEWAY IN FRONT OF MANY ACCOUNTS HAS TO SAY NO. Every byte of an upload lands on this
//    machine's disk before it is sealed, and every upload in pieces keeps a directory of plaintext
//    until it is finished; with no ceiling, one client with a loop fills the disk every other
//    account's uploads need. The answers are S3's own, so a client does what it already does with
//    them: `EntityTooLarge` stops, `SlowDown` waits and sends again.
import { S3Refusal } from "./answer.js";
/** How many writes one gateway runs at once before it answers `SlowDown`. */
export const MAX_CONCURRENT_WRITES = 16;
/** How many uploads in pieces one bucket may have begun and not finished. */
export const MAX_UPLOADS_PER_BUCKET = 1000;
/** How long a client told `SlowDown` is asked to wait, in seconds. */
export const RETRY_AFTER_SECONDS = 1;
/**
 * `SlowDown`, with the wait it names.
 *
 * ⚠ NOT AN `S3Refusal`, which carries no wait: this is read by its `status` (503) and `retryAfter`,
 *   which is how the answer layer turns any 503 into `SlowDown` with a `Retry-After` header.
 */
export class SlowDown extends Error {
    status = 503;
    retryAfter = RETRY_AFTER_SECONDS;
    constructor(message) {
        super(message);
        this.name = "SlowDown";
    }
}
/** The object, or the part of it that arrived, is larger than this gateway takes. */
export function tooLarge(max) {
    return new S3Refusal(400, "EntityTooLarge", `Your proposed upload exceeds the maximum allowed size: this gateway takes objects of at most ${max} bytes. Nothing was stored.`);
}
/** Refuse a declared size over the limit, before a byte of it is read. */
export function checkDeclaredSize(size, max) {
    if (max !== undefined && size !== null && size > max)
        throw tooLarge(max);
}
/**
 * Whether NMTS stores a file with no bytes, which is not the same thing as a folder marker.
 *
 * ⛔ THE ONE PLACE THAT DECIDES IT. The upload path stores an empty file (sealed, it is a header and
 *    one empty final chunk, and costs one credit), so an empty object is stored like any other.
 *    Set this to `false` and an empty object is refused before anything is spent, with a 400 a
 *    client does not retry — never handed to a store that would fail with a 500 naming a path.
 */
export const STORES_EMPTY_FILES = true;
/** Refuse an object with no bytes, unless empty files are stored. A folder marker never comes here. */
export function checkNotEmpty(size) {
    if (STORES_EMPTY_FILES || size !== 0)
        return;
    throw new S3Refusal(400, "InvalidRequest", "NMTS does not store empty files: an object with no bytes has nothing for the storage network to hold. " +
        "A key ending in `/` with no bytes makes a folder. Nothing was stored.");
}
