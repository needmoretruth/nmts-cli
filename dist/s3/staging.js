// Where the pieces of a multipart upload wait until they are one file.
//
// ⛔ ITS OWN MODULE SO IT CAN BE TESTED WITHOUT AN ACCOUNT. What goes wrong here is ordering and
//    integrity -- pieces arrive at the same time and out of order, and one that changed on the way
//    becomes part of a file that opens and is wrong. Both are testable against a real directory
//    with a stub for the one thing that costs money, and neither is testable through a command that
//    starts by opening a session.
//
// ⛔ ONE STORE PER GATEWAY, KEYED BY BUCKET, AND NEVER BOUND TO THE DRIVE AN UPLOAD BEGAN UNDER.
//    A gateway in front of many accounts rebuilds a bucket's drive whenever it asks again whose the
//    bucket is — with a fresh delegation token, or for a different user. The pieces must outlive
//    that, and the file they make must be stored through the drive the bucket has NOW: bound to the
//    first one, every finish after its token expired was refused, and a bucket handed to another
//    user stored that user's uploads in the first user's account. So a drive asks for a `view` of
//    the store (`multipart-view.ts`), handing it its own `store` and `owner`, and an upload
//    remembers which account it began under: asked about by any other, it is gone, and its pieces
//    with it.
//
// ⛔ ONE DIRECTORY PER UPLOAD, 0700, AND EVERY PIECE 0600. The pieces are somebody's plaintext; left
//    in a shared temporary directory under a predictable name they would be readable by every other
//    account on the machine, for as long as the upload takes.
//
// ⛔ ONLY SUCCESS AND ABORT REMOVE THE PIECES. A finish that fails — the store refused, the network
//    dropped — leaves every piece where it was, so the client's retry of the same finish has
//    something to finish. Removing them on failure turned one dropped connection into re-sending
//    the whole file. What was neither finished nor aborted goes once nobody has touched it for
//    `UPLOAD_LIFETIME_MS` — counted from the last piece or attempt, not from when it began, so a
//    slow upload of a large file is not taken away while it is still arriving.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOADS_PER_BUCKET } from "./drive-limits.js";
import { sweepRoot, touch, uploadDirName } from "./multipart-sweep.js";
import { bucketView } from "./multipart-view.js";
/** How long an upload nobody has touched is kept. S3 leaves this to a lifecycle rule. */
export const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** How long a finished upload is remembered, so a finish sent twice is answered the same twice. */
export const FINISHED_MEMORY_MS = 60 * 60 * 1000;
/** How often a gateway's own store sweeps its directory, and marks the uploads it is working on. */
export const SWEEP_EVERY_MS = 60 * 60 * 1000;
export function createStagingStore(root, options = {}) {
    const clock = options.clock ?? Date.now;
    const inFlight = new Map();
    const finished = new Map();
    const dirOf = (uploadId) => join(root, uploadDirName(uploadId));
    const busy = (upload) => upload.finishing !== null || upload.arriving > 0;
    const drop = async (uploadId, upload) => {
        if (inFlight.get(uploadId) === upload)
            inFlight.delete(uploadId);
        if (upload.finishing === null)
            await rm(dirOf(uploadId), { recursive: true, force: true });
    };
    const sweepMemory = async () => {
        const now = clock();
        for (const [uploadId, done] of finished) {
            if (now - done.at > FINISHED_MEMORY_MS)
                finished.delete(uploadId);
        }
        for (const [uploadId, upload] of inFlight) {
            if (busy(upload) || now - upload.lastActivity <= UPLOAD_LIFETIME_MS)
                continue;
            await drop(uploadId, upload);
        }
    };
    const book = {
        inFlight,
        finished,
        clock,
        maxPerBucket: options.maxUploadsPerBucket ?? MAX_UPLOADS_PER_BUCKET,
        dirOf,
        drop,
        sweepMemory,
    };
    let sweeping = null;
    const sweep = () => {
        sweeping ??= (async () => {
            try {
                await sweepMemory();
                // ⚠ What this process is working on is marked first, so another process sharing the
                //   directory never finds it a day old.
                for (const [uploadId, upload] of inFlight) {
                    if (busy(upload))
                        await touch(dirOf(uploadId), Date.now());
                }
                await sweepRoot(root, clock(), UPLOAD_LIFETIME_MS, (uploadId) => inFlight.has(uploadId));
            }
            finally {
                sweeping = null;
            }
        })();
        return sweeping;
    };
    // ⚠ A TIMER ONLY WHEN ASKED FOR, AND ONE THAT DOES NOT KEEP A PROCESS ALIVE: a gateway asks, a
    //   test driving the staging directly does not.
    let timer = null;
    if (options.sweepEveryMs !== undefined) {
        void sweep().catch(() => undefined);
        timer = setInterval(() => void sweep().catch(() => undefined), options.sweepEveryMs);
        timer.unref();
    }
    return {
        view: (bucket, account) => bucketView(book, bucket, account),
        sweep,
        async close() {
            if (timer !== null)
                clearInterval(timer);
            timer = null;
            const running = [...inFlight.values()].map((upload) => upload.finishing).filter((f) => f !== null);
            await Promise.allSettled([...running, ...(sweeping === null ? [] : [sweeping])]);
        },
    };
}
/**
 * A staging for one bucket whose account never changes, storing through `store`: what a caller that
 * builds its drive once needs, and nothing more.
 */
export function createStaging(root, store, clock = Date.now) {
    return createStagingStore(root, { clock }).view("", { store });
}
