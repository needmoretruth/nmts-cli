// One bucket's uploads in pieces, as the drive the bucket has now sees them. One of the parts of
// `staging.ts`, which holds what is shared by every bucket; only it imports this.
//
// ⛔ EVERY OPERATION ASKS WHOSE THE BUCKET IS NOW. An upload remembers the account it began under,
//    and the drive handing out this view says which account it is; when the two differ the bucket
//    has been given to somebody else, and the upload is gone for this caller — refused as
//    `NoSuchUpload`, and its pieces removed, the first time anybody asks about it.
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { S3Refusal } from "./answer.js";
import { checkNotEmpty, SlowDown, tooLarge } from "./drive-limits.js";
import { compareKeys } from "./listing.js";
import { checkComposite, joinPieces } from "./multipart-assemble.js";
import { spoolBody } from "./spool.js";
function noSuchUpload() {
    return new S3Refusal(404, "NoSuchUpload", "No upload is in progress with that id. It may have been finished, aborted, or left untouched for more than a day.");
}
/** A tag as a client may send it back: with or without its quotes. */
function bare(etag) {
    return etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}
/**
 * A new upload id: the time it began, then randomness, all hex.
 *
 * ⛔ SORTED BY TIME AS A STRING. `ListMultipartUploads` resumes after an id, and S3 lists one key's
 *    uploads by when they began; an id that sorts the same way lets a listing resume after an id
 *    even once that upload is gone, without skipping the key's later ones.
 */
function newUploadId(now) {
    return `${Math.max(0, Math.floor(now)).toString(16).padStart(12, "0")}${randomBytes(10).toString("hex")}`;
}
export function bucketView(book, bucket, account) {
    const { inFlight, finished, clock } = book;
    const ownerNow = async () => (account.owner === undefined ? null : await account.owner());
    const limit = account.maxObjectBytes;
    const active = (upload) => {
        upload.lastActivity = clock();
    };
    /** The upload with this id in this bucket, still the current account's, or NoSuchUpload. */
    const current = async (uploadId) => {
        const upload = inFlight.get(uploadId);
        if (upload === undefined || upload.bucket !== bucket)
            throw noSuchUpload();
        if (upload.owner !== (await ownerNow())) {
            // ⛔ The bucket answers to another account now. The upload is not theirs to finish, list or
            //    see, and the pieces are nobody's any more.
            await book.drop(uploadId, upload);
            throw noSuchUpload();
        }
        return upload;
    };
    /** …and only for the key it began with, which is S3's rule too. */
    const opened = async (uploadId, key) => {
        const upload = await current(uploadId);
        if (upload.key !== key)
            throw noSuchUpload();
        return upload;
    };
    const assembleAndStore = async (uploadId, upload, chosen, options) => {
        const dir = book.dirOf(uploadId);
        const whole = join(dir, `whole-${randomBytes(16).toString("hex")}`);
        try {
            await joinPieces(whole, chosen.map((piece) => join(dir, piece.file)), options.checksum);
            const outcome = await account.store(upload.key, whole, upload.meta, options.condition);
            inFlight.delete(uploadId);
            finished.set(uploadId, { bucket, key: upload.key, owner: upload.owner, outcome, at: clock() });
            await rm(dir, { recursive: true, force: true });
            return outcome;
        }
        finally {
            await rm(whole, { force: true });
        }
    };
    return {
        async begin(key, meta) {
            await book.sweepMemory();
            let open = 0;
            for (const upload of inFlight.values())
                if (upload.bucket === bucket)
                    open += 1;
            if (open >= book.maxPerBucket) {
                throw new SlowDown(`This bucket already has ${open} uploads begun and not finished, the most this gateway keeps. ` +
                    "Finish or abort one, or wait for one to finish.");
            }
            const owner = await ownerNow();
            const now = clock();
            const uploadId = newUploadId(now);
            await mkdir(book.dirOf(uploadId), { recursive: true, mode: 0o700 });
            inFlight.set(uploadId, {
                bucket,
                key,
                meta,
                owner,
                initiated: now,
                lastActivity: now,
                arriving: 0,
                pieces: new Map(),
                finishing: null,
            });
            return uploadId;
        },
        // ⛔ EACH PIECE IS ITS OWN FILE, and nothing is appended: a real client sends them concurrently
        //    and out of order (measured from rclone: 1, 3, 2), and sends one again when a connection
        //    drops. The piece is only counted once its bytes are in AND the body's rules held.
        async part(uploadId, key, partNumber, body) {
            const upload = await opened(uploadId, key);
            const dir = book.dirOf(uploadId);
            const file = `${partNumber}-${randomBytes(16).toString("hex")}`;
            const path = join(dir, file);
            const temporary = `${path}.arriving`;
            active(upload);
            upload.arriving += 1;
            let spooled;
            try {
                spooled = await spoolBody(body, temporary, { md5: true, limit });
                await rename(temporary, path);
            }
            catch (error) {
                await rm(temporary, { force: true });
                // An abort that landed while this piece was arriving took its directory with it.
                if (inFlight.get(uploadId) !== upload)
                    throw noSuchUpload();
                throw error;
            }
            finally {
                upload.arriving -= 1;
                active(upload);
            }
            // …or landed just after, and took the upload with it.
            if (inFlight.get(uploadId) !== upload) {
                await rm(path, { force: true });
                throw noSuchUpload();
            }
            const etag = `"${spooled.md5 ?? ""}"`;
            const before = upload.pieces.get(partNumber);
            const checksums = new Map(body.checksums?.() ?? []);
            upload.pieces.set(partNumber, { partNumber, etag, size: spooled.size, stagedAt: clock(), file, checksums });
            // A finish reading the old piece keeps it; the directory goes with the upload either way.
            if (before !== undefined && upload.finishing === null) {
                await rm(join(dir, before.file), { force: true });
            }
            return etag;
        },
        async complete(uploadId, key, parts, options = {}) {
            const done = finished.get(uploadId);
            if (done !== undefined && done.bucket === bucket && done.key === key && done.owner === (await ownerNow())) {
                return done.outcome;
            }
            const upload = await current(uploadId);
            if (upload.key !== key) {
                throw new S3Refusal(400, "InvalidRequest", "That upload was begun for a different key. Finish it at the key it began with.");
            }
            active(upload);
            if (upload.finishing !== null) {
                options.accepted?.();
                return upload.finishing;
            }
            const chosen = [];
            let last = 0;
            let total = 0;
            for (const asked of parts) {
                if (asked.partNumber <= last) {
                    throw new S3Refusal(400, "InvalidPartOrder", "The parts must be listed once each, in ascending order of part number.");
                }
                last = asked.partNumber;
                const piece = upload.pieces.get(asked.partNumber);
                if (piece === undefined || bare(piece.etag) !== bare(asked.etag)) {
                    throw new S3Refusal(400, "InvalidPart", `Part ${asked.partNumber} was not staged with that tag. Send it again, or list the tag it was answered with.`);
                }
                chosen.push(piece);
                total += piece.size;
            }
            if (limit !== undefined && total > limit)
                throw tooLarge(limit);
            checkNotEmpty(total);
            checkComposite(options.checksum, chosen.map((piece) => piece.checksums));
            options.accepted?.();
            const finishing = assembleAndStore(uploadId, upload, chosen, options);
            upload.finishing = finishing;
            try {
                return await finishing;
            }
            catch (error) {
                // ⛔ The pieces stay — see the top of `staging.ts` — unless the upload was dropped meanwhile.
                if (upload.finishing === finishing)
                    upload.finishing = null;
                if (inFlight.get(uploadId) !== upload)
                    await rm(book.dirOf(uploadId), { recursive: true, force: true });
                throw error;
            }
            finally {
                active(upload);
            }
        },
        async abort(uploadId, key) {
            const upload = await opened(uploadId, key);
            // ⛔ A FINISH IN PROGRESS IS WAITED FOR, NOT CUT SHORT. Its store is reading the joined file
            //    out of this directory; removing it underneath stored a truncated file, or failed a finish
            //    the client had every reason to think would work. Once it has settled, a finish that
            //    worked means there is nothing left to abort — S3's `NoSuchUpload` — and one that failed
            //    has left its pieces, which this then removes.
            const finishing = upload.finishing;
            if (finishing !== null) {
                await finishing.catch(() => undefined);
                if (inFlight.get(uploadId) !== upload)
                    throw noSuchUpload();
            }
            await book.drop(uploadId, upload);
        },
        async parts(uploadId, key) {
            const upload = await opened(uploadId, key);
            return [...upload.pieces.values()]
                .sort((a, b) => a.partNumber - b.partNumber)
                .map(({ partNumber, etag, size, stagedAt }) => ({ partNumber, etag, size, stagedAt }));
        },
        async uploads() {
            const owner = await ownerNow();
            const out = [];
            for (const [uploadId, upload] of [...inFlight.entries()]) {
                if (upload.bucket !== bucket)
                    continue;
                if (upload.owner !== owner) {
                    await book.drop(uploadId, upload);
                    continue;
                }
                out.push({ uploadId, key: upload.key, meta: upload.meta, initiated: upload.initiated });
            }
            return out.sort((a, b) => compareKeys(a.key, b.key) || (a.uploadId < b.uploadId ? -1 : a.uploadId > b.uploadId ? 1 : 0));
        },
    };
}
