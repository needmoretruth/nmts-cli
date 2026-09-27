// One account behind the gateway: its file list, its reader, and the rule every upload passes.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, WHICH IS THE WHOLE REASON THIS FILE EXISTS. `nmts s3` serves
//    the drive of whoever is at this machine; the SDK's gateway serves whichever account a
//    business's resolver hands back. What the two do with an upload -- spool it, ask whether the
//    key already holds exactly these bytes, make the folders above it, store it (replacing what is
//    there, or refusing to), read the list again for the tag of what was stored -- is the same
//    work (`drive-write.ts`), and a second copy of it would be a second place for the same-file
//    rule to be got right. The two differ only in where the account comes from, which is the seam
//    below.
//
// ⛔ THE SAME-FILE QUESTION IS ANSWERED IN ONE PLACE. Both ways of uploading -- one PUT, or pieces
//    staged and joined -- end in the same store, so a rule written there cannot disagree with
//    itself; written in the protocol layer it would have to be written twice, once for each, and
//    the two would differ the first time one of them changed.
import { fetchFile } from "../download.js";
import { KIND_FOLDER } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { createKeyLocks } from "./drive-lock.js";
import { createWriter } from "./drive-write.js";
import { createStagingStore } from "./staging.js";
export { placeOf } from "./drive-write.js";
/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts. Every write reads the list fresh, past this cache.
 */
export const LIST_CACHE_MS = 5_000;
/** The real reader: the stored bytes, opened with this account's key and delivered to the sink. */
export async function fetchObject(reader, object, sink) {
    const wrapped = object.entry.dekWrapped;
    if (wrapped === undefined)
        throw new NmtsError("That entry has no key in the file list.");
    await fetchFile({
        base: reader.server,
        apiKey: reader.bearer,
        accountCode: reader.code,
        itemId: object.entry.id,
        size: object.size,
        dekWrapped: wrapped,
        contentHashCt: object.entry.contentHashCt,
        chain: reader.chain,
        sink,
        ...(reader.read === undefined ? {} : { read: reader.read }),
    });
}
/** A folder marker's bytes: none. Nothing is fetched, because a folder has nothing stored. */
async function deliverNothing(sink) {
    sink.expect(0);
    await sink.commit();
}
/** One account as the protocol layer sees it: a cached list, a reader, and a writer when allowed. */
export function createDriveSource(options) {
    const account = options.account;
    const cacheMs = options.listCacheMs ?? LIST_CACHE_MS;
    let cached = [];
    let cachedAt = 0;
    const entries = async (asked) => {
        if (asked?.fresh !== true && Date.now() - cachedAt < cacheMs)
            return cached;
        const read = await account.readList();
        cached = read;
        cachedAt = Date.now();
        return read;
    };
    // ⚠ ASKED ONCE PER DRIVE, and asked again after a failure rather than remembering it.
    const ownerOf = options.owner;
    let owner = null;
    const ownerNow = () => {
        if (ownerOf === undefined)
            return Promise.resolve(null);
        owner ??= ownerOf().catch((error) => {
            owner = null;
            throw error;
        });
        return owner;
    };
    return {
        entries,
        fetch: (object, sink) => (object.entry.kind === KIND_FOLDER ? deliverNothing(sink) : account.fetch(object, sink)),
        ...(options.writable
            ? {
                write: createWriter({
                    account,
                    entries,
                    forget: () => {
                        cachedAt = 0;
                    },
                    stagingRoot: options.stagingRoot,
                    staging: options.staging ?? createStagingStore(options.stagingRoot),
                    bucket: options.bucket ?? "",
                    owner: ownerNow,
                    locks: options.locks ?? createKeyLocks(),
                    overwrite: options.overwrite ?? "refuse",
                    maxObjectBytes: options.maxObjectBytes,
                    onAlreadyStored: options.onAlreadyStored,
                }),
            }
            : {}),
    };
}
