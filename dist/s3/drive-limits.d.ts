import { S3Refusal } from "./answer.ts";
/** How many writes one gateway runs at once before it answers `SlowDown`. */
export declare const MAX_CONCURRENT_WRITES = 16;
/** How many uploads in pieces one bucket may have begun and not finished. */
export declare const MAX_UPLOADS_PER_BUCKET = 1000;
/** How long a client told `SlowDown` is asked to wait, in seconds. */
export declare const RETRY_AFTER_SECONDS = 1;
/**
 * `SlowDown`, with the wait it names.
 *
 * ⚠ NOT AN `S3Refusal`, which carries no wait: this is read by its `status` (503) and `retryAfter`,
 *   which is how the answer layer turns any 503 into `SlowDown` with a `Retry-After` header.
 */
export declare class SlowDown extends Error {
    readonly status = 503;
    readonly retryAfter = 1;
    constructor(message: string);
}
/** The object, or the part of it that arrived, is larger than this gateway takes. */
export declare function tooLarge(max: number): S3Refusal;
/** Refuse a declared size over the limit, before a byte of it is read. */
export declare function checkDeclaredSize(size: number | null, max: number | undefined): void;
/**
 * Whether NMTS stores a file with no bytes, which is not the same thing as a folder marker.
 *
 * ⛔ THE ONE PLACE THAT DECIDES IT. The upload path stores an empty file (sealed, it is a header and
 *    one empty final chunk, and costs one credit), so an empty object is stored like any other.
 *    Set this to `false` and an empty object is refused before anything is spent, with a 400 a
 *    client does not retry — never handed to a store that would fail with a 500 naming a path.
 */
export declare const STORES_EMPTY_FILES: boolean;
/** Refuse an object with no bytes, unless empty files are stored. A folder marker never comes here. */
export declare function checkNotEmpty(size: number | null): void;
