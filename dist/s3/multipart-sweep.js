// Removing what a gateway left in its staging directory and nobody will come back for.
//
// ⛔ THE DIRECTORY, NOT THE MEMORY. A process that stopped — a restart, a crash, a deploy — takes
//    its record of every upload with it, and the pieces on disk are somebody's plaintext that no
//    request can reach any more. Walking only the uploads a process remembers never finds them. So
//    the directory itself is read, when a gateway starts and every so often after.
//
// ⛔ ONLY WHAT THIS GATEWAY'S NAMES MADE, AND ONLY WHAT NOBODY HAS TOUCHED FOR A DAY. A staging
//    directory a caller named may hold anything else, and may be shared by several processes of
//    the same backend. A name this gateway did not make is never touched, and one it did make is
//    removed only when neither it nor anything in it has changed for `UPLOAD_LIFETIME_MS`. A
//    process working on an upload touches its directory while it does (`staging.ts`), so an upload
//    in use by another process is never a day old.
import { randomUUID } from "node:crypto";
import { lstat, readdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
/** An upload's directory: `nmts-mpu-` and the upload id. */
export const UPLOAD_DIR = /^nmts-mpu-([0-9a-f]{32})$/;
/** A single upload's body, spooled before it is stored: `nmts-put-` and a random id. */
export const SPOOL_FILE = /^nmts-put-[0-9a-f-]{36}$/;
/** The directory an upload's pieces live in. */
export function uploadDirName(uploadId) {
    return `nmts-mpu-${uploadId}`;
}
/** A fresh name for one upload's spooled body. */
export function spoolFileName() {
    return `nmts-put-${randomUUID()}`;
}
/** The newest change to a path or, for a directory, to anything directly in it. Null when it is gone. */
async function lastChanged(path) {
    let newest;
    try {
        const own = await lstat(path);
        newest = own.mtimeMs;
        if (!own.isDirectory())
            return newest;
    }
    catch {
        return null;
    }
    let names;
    try {
        names = await readdir(path);
    }
    catch {
        return newest;
    }
    for (const name of names) {
        try {
            newest = Math.max(newest, (await lstat(join(path, name))).mtimeMs);
        }
        catch {
            // Removed while this looked: its going is a change too, and the directory's time shows it.
        }
    }
    return newest;
}
/** Mark a directory as in use now, so no process's sweep takes it for abandoned. */
export async function touch(path, now) {
    const at = new Date(now);
    await utimes(path, at, at).catch(() => undefined);
}
/**
 * Remove every upload directory and spooled body under `root` that this gateway's names made, that
 * `inUse` does not claim, and that has not changed for `lifetimeMs`.
 */
export async function sweepRoot(root, now, lifetimeMs, inUse) {
    let names;
    try {
        names = await readdir(root);
    }
    catch {
        return;
    }
    for (const name of names) {
        const upload = UPLOAD_DIR.exec(name);
        if (upload === null && !SPOOL_FILE.test(name))
            continue;
        if (upload !== null && inUse(upload[1] ?? ""))
            continue;
        const path = join(root, name);
        const changed = await lastChanged(path);
        if (changed === null || now - changed <= lifetimeMs)
            continue;
        await rm(path, { recursive: true, force: true });
    }
}
