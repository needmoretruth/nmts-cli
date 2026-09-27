// Joining the pieces of an upload into one file, and holding it to the checksum the finish named.
//
// ⛔ THE CHECKSUM ON A FINISH IS THE WHOLE OBJECT'S, NOT THE FINISH'S BODY. `x-amz-checksum-*` on
//    `CompleteMultipartUpload` is what the client says the assembled object comes to — and it used
//    to be checked against the XML of the part list, which it never matches, so a client that sent
//    one could never finish. S3 knows two kinds:
//      · `FULL_OBJECT`: a checksum of every byte, in order. Computed here while the pieces are
//        joined, and a file that does not match is not stored.
//      · `COMPOSITE` (S3's default for a finish): a checksum of the pieces' own checksums, joined in
//        order, with `-N` after it. It is checked from the checksums each piece arrived with, when
//        every chosen piece arrived with one of that kind; ⚠ when any did not, there is nothing to
//        check it against here, and it is accepted without being checked — the pieces themselves
//        were each held to whatever their own requests promised.
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Refusal } from "./answer.js";
import { runningChecksum } from "./checksum.js";
function mismatch(algorithm) {
    return new S3Refusal(400, "BadDigest", `The ${algorithm.toUpperCase()} you specified for the whole object did not match the calculated checksum. Nothing was stored.`);
}
/**
 * Check a composite checksum against the pieces' own, before anything is joined. Returns without
 * checking when a piece has no checksum of that kind (see the top of this file).
 */
export function checkComposite(checksum, pieces) {
    if (checksum === null || checksum === undefined || checksum.type !== "COMPOSITE")
        return;
    const running = runningChecksum(checksum.algorithm);
    for (const piece of pieces) {
        const own = piece.get(checksum.algorithm);
        if (own === undefined)
            return;
        running.update(own);
    }
    if (!running.digest().equals(checksum.value))
        throw mismatch(checksum.algorithm);
}
/**
 * Write these files one after another into a new file, 0600, computing a `FULL_OBJECT` checksum
 * as they pass, and refuse the result when it does not match.
 */
export async function joinPieces(whole, paths, checksum) {
    const full = checksum !== null && checksum !== undefined && checksum.type === "FULL_OBJECT" ? checksum : null;
    const running = full === null ? null : runningChecksum(full.algorithm);
    const out = createWriteStream(whole, { flags: "wx", mode: 0o600 });
    try {
        for (const path of paths) {
            const measuring = new Transform({
                transform(chunk, _encoding, next) {
                    running?.update(chunk);
                    next(null, chunk);
                },
            });
            await pipeline(createReadStream(path), measuring, out, { end: false });
        }
        await new Promise((resolve, reject) => {
            out.once("error", reject);
            out.end(resolve);
        });
    }
    catch (error) {
        out.destroy();
        throw error;
    }
    if (full !== null && running !== null && !running.digest().equals(full.value))
        throw mismatch(full.algorithm);
}
