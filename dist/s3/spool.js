// A request body, taken off the socket: into a file for an object, into memory for a small XML ask.
//
// ⛔ THE BODY IS WAITED FOR TWICE, AND BOTH WAITS ARE HERE. Once for its bytes and once for its
//    verdict — `verified`, which only settles after the last byte is in. Everything that stores a
//    body goes through this file, so "spooled but not yet verified" cannot be mistaken for
//    "ready to store" in one caller and not another.
//
// ⚠ THE VERDICT IS LISTENED TO BEFORE THE FIRST BYTE IS READ. A body that fails while it is still
//   arriving rejects `verified` with nobody awaiting it yet, and an unheard rejection takes the
//   whole process down with it — every other upload in flight included.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Refusal } from "./answer.js";
import { tooLarge } from "./drive-limits.js";
/** `verified`, as a value: null when it held, the refusal otherwise. Never rejects. */
function heard(body) {
    return body.verified.then(() => null, (refusal) => refusal ?? new S3Refusal(400, "InvalidRequest", "The request body was refused."));
}
function shortOrLong(declared, arrived) {
    return new S3Refusal(400, "IncompleteBody", `The request said ${declared} bytes and ${arrived} arrived. Nothing was stored.`);
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
export async function spoolBody(body, path, options) {
    const verdict = heard(body);
    const digest = options.md5 ? createHash("md5") : null;
    const limit = options.limit;
    let size = 0;
    const counting = new Transform({
        transform(chunk, _encoding, next) {
            size += chunk.length;
            if (limit !== undefined && size > limit) {
                next(tooLarge(limit));
                return;
            }
            digest?.update(chunk);
            next(null, chunk);
        },
    });
    await pipeline(body.stream, counting, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    const refusal = await verdict;
    if (refusal !== null)
        throw refusal;
    if (body.size !== null && size !== body.size)
        throw shortOrLong(body.size, size);
    return { size, md5: digest === null ? null : digest.digest("hex") };
}
/**
 * Read a small body — an XML ask — into a string, refusing one larger than `limit` bytes.
 *
 * ⚠ AN OVERSIZED BODY IS READ TO ITS END AND DISCARDED rather than cut off. Stopping mid-body
 *   tears the connection down, and a client told nothing but "connection reset" retries the same
 *   request; the refusal below is what tells it why.
 */
export async function readBodyText(body, limit, what) {
    const tooLarge = new S3Refusal(400, "MalformedXML", `${what} is larger than ${limit} bytes.`);
    const verdict = heard(body);
    if (body.size !== null && body.size > limit) {
        body.stream.resume();
        throw tooLarge;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of body.stream) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk instanceof Uint8Array ? chunk : new Uint8Array(0);
        total += bytes.length;
        if (total <= limit)
            chunks.push(bytes);
    }
    if (total > limit)
        throw tooLarge;
    const refusal = await verdict;
    if (refusal !== null)
        throw refusal;
    if (body.size !== null && total !== body.size)
        throw shortOrLong(body.size, total);
    return Buffer.concat(chunks).toString("utf8");
}
/**
 * Run `use` on a decoded body; when it fails, whatever of the body is still unread is read and dropped.
 *
 * ⛔ A BODY NOBODY READS HOLDS THE CONNECTION. The decoder pauses the request while its output is
 *    full, so a refusal answered before the body was consumed — no such upload, a key that is not
 *    free — would leave the client stuck mid-upload, never reading the answer it was sent.
 */
export async function consuming(body, use) {
    try {
        return await use();
    }
    catch (error) {
        body.stream.resume();
        throw error;
    }
}
