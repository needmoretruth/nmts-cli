// This machine's copies of the file list's chunks, kept by name (NCF-3 §6.3).
//
// ⛔ A CHUNK IS NAMED BY THE HASH OF ITS OWN BYTES, so a copy under that name can never be stale:
//    when the bytes change the name changes, and the index names the new one. That is the whole
//    reason this exists — a reload fetches only what the index newly names, and an edit that
//    rewrote one chunk costs one download instead of the whole list.
//
// ⛔ AND IT IS STILL CHECKED ON THE WAY OUT. The reader re-hashes what it reads from here before
//    opening it (`manifest-chunk-flow.ts`). A directory on this machine is not a trusted store:
//    whoever holds the machine can edit it, and the index is the only thing that says which bytes
//    belong to which version.
//
// ⛔ WHAT IS STORED IS SEALED. These are the account's names, folders and file keys, sealed with
//    the account code — the same bytes the server holds and cannot read. They are written 0600 in
//    a 0700 directory, beside the kept copy of the index and for the same reason.
//
// ⚠ NOTHING HERE THROWS. A cache that cannot be read or written is a slower command, never a
//   broken one: every function answers "no copy" and the network path behind it does the work.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
/** A chunk's name: base64url SHA-256, unpadded — 43 characters, and it becomes a file name. */
const NAME = /^[A-Za-z0-9_-]{43}$/;
/**
 * ⛔ AN ACCOUNT ID BECOMES PART OF A PATH HERE, so it is CHECKED rather than trusted — the same
 *    check `manifest.ts` makes on the kept list, and for the same reason: a value that reaches a
 *    path join unchecked is how `..` becomes a write somewhere else.
 */
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;
/** Where one account's chunks live, or null when the id is not one this tool derived. */
function dirFor(accountId) {
    if (!ACCOUNT.test(accountId))
        return null;
    return join(configDir(), "file-list-chunks", accountId);
}
function pathFor(accountId, hash) {
    const dir = dirFor(accountId);
    if (dir === null || !NAME.test(hash))
        return null;
    return join(dir, `${hash}.ct`);
}
/** The sealed bytes this machine holds under that name, or null when it holds none. */
export function readCachedChunk(accountId, hash) {
    const path = pathFor(accountId, hash);
    if (path === null)
        return null;
    try {
        const text = readFileSync(path, "utf8").trim();
        return text === "" ? null : text;
    }
    catch {
        return null;
    }
}
/** Keep these sealed bytes under that name. Silent when the machine will not take them. */
export function writeCachedChunk(accountId, hash, ct) {
    const dir = dirFor(accountId);
    const path = pathFor(accountId, hash);
    if (dir === null || path === null)
        return;
    try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(path, `${ct}\n`, { mode: 0o600 });
    }
    catch {
        // Out of space, read-only home, a directory somebody removed underneath: the next read of the
        // list fetches from the server instead, which is what this cache is an optimisation of.
    }
}
/**
 * Drop every copy this account holds that the given list does not name.
 *
 * ⛔ THIS IS THE BOUND ON THE CACHE, and it is a set rather than a size or an age. A chunk the
 *    current list does not name is a version of the list nobody will ask for again — no timer can
 *    say that, and a size limit would evict a chunk the list still needs while keeping one it
 *    abandoned. Called after every complete read and every successful write, which is exactly when
 *    "what the list names" is known.
 */
export function pruneChunkCache(accountId, keep) {
    const dir = dirFor(accountId);
    if (dir === null)
        return;
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const name of names) {
        if (!name.endsWith(".ct"))
            continue;
        if (keep.has(name.slice(0, -3)))
            continue;
        try {
            rmSync(join(dir, name), { force: true });
        }
        catch {
            // A copy that will not delete costs disk and nothing else; it is named by a hash, so it can
            // never be handed back as some other version.
        }
    }
}
