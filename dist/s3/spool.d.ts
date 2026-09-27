import type { DecodedBody } from "./body.ts";
/** What a spooled body came to. */
export interface Spooled {
    readonly size: number;
    /** Hex MD5 of the bytes, when it was asked for — what S3 answers as a part's tag. */
    readonly md5: string | null;
}
/**
 * Write a body to a new file, 0600, and return only once every rule the request carried held.
 *
 * ⛔ THE FILE IS CREATED EXCLUSIVELY. Its name is the caller's fresh random one; a file already
 *    there under that name is not ours, and writing into it would be writing somebody's plaintext
 *    into a file somebody else can read.
 *
 * ⛔ `limit` COUNTS THE BYTES THAT ARRIVE, NOT THE ONES DECLARED. A length header is the client's
 *    word; the spool stops, and the upload is refused, the moment one byte past the limit is in.
 */
export declare function spoolBody(body: DecodedBody, path: string, options: {
    md5: boolean;
    limit?: number | undefined;
}): Promise<Spooled>;
/**
 * Read a small body — an XML ask — into a string, refusing one larger than `limit` bytes.
 *
 * ⚠ AN OVERSIZED BODY IS READ TO ITS END AND DISCARDED rather than cut off. Stopping mid-body
 *   tears the connection down, and a client told nothing but "connection reset" retries the same
 *   request; the refusal below is what tells it why.
 */
export declare function readBodyText(body: DecodedBody, limit: number, what: string): Promise<string>;
/**
 * Run `use` on a decoded body; when it fails, whatever of the body is still unread is read and dropped.
 *
 * ⛔ A BODY NOBODY READS HOLDS THE CONNECTION. The decoder pauses the request while its output is
 *    full, so a refusal answered before the body was consumed — no such upload, a key that is not
 *    free — would leave the client stuck mid-upload, never reading the answer it was sent.
 */
export declare function consuming<T>(body: DecodedBody, use: () => Promise<T>): Promise<T>;
