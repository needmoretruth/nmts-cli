// The drive as an S3 client sees it: one bucket, and a key for every live file.
//
// ⛔ THE MAPPING IS THE WHOLE DESIGN, so it is written down here rather than spread across the
//    server. A key is the file's path with the leading slash removed -- `photos/a.jpg` -- because
//    that is what every S3 tool will put back on the disk when it syncs. Nothing else in this
//    account's shape is exposed: not item ids, not the trash, not the marks.
//
// ⛔ TRASHED FILES ARE NOT KEYS. Being in the trash is inherited from a folder, so filtering on the
//    entry's own field alone would list files whose bytes the server already refuses -- an S3 client
//    would see them, ask for them, and get a failure for every one.
//
// ⛔ A FOLDER IS A FOLDER MARKER: the key `photos/`, no bytes, and the tag of an empty object.
//    That is how S3 itself holds an empty folder — the zero-byte object a console's "create folder"
//    makes and every sync tool knows to skip — so a folder here lists, HEADs and GETs exactly like
//    one there, and a zero-byte PUT of `photos/` is how a client makes one. Without it a folder
//    holding no files could only be seen as a common prefix, and a client that made one with a
//    marker was told 200 and then 404 for the key it had just written.
import { createHash } from "node:crypto";
import { buildIndex, fullPathOf, isLive, KIND_FOLDER } from "../drive-paths.js";
/**
 * The bucket `nmts s3` serves. Named for what it is, and not configurable: two names for one drive
 * is worse.
 *
 * ⚠ IT IS THIS COMMAND'S ANSWER, NOT THE SERVER'S RULE. The gateway takes a resolver, because a
 *   business running it in front of many of its users' accounts has one bucket per account; what
 *   `nmts s3` hands it is a resolver that knows this name and no other.
 */
export const BUCKET = "drive";
/** S3's own ceiling, and the default when a client does not ask for one. */
export const MAX_KEYS_LIMIT = 1000;
/**
 * An ETag that is stable for a file and changes when the file does.
 *
 * ⛔ IT IS A HASH OF WHAT CHANGES WHEN THE FILE DOES: the entry's id, its time and its size. A file
 *    replaced at the same key is a new entry; one edited in place has a new time. The tag used to
 *    be the id and the time laid side by side and cut to 32 characters, which for a long id cut the
 *    time off altogether — and a tag that does not change when the file does is how a sync tool
 *    decides there is nothing to fetch.
 *
 * ⛔ IT ENDS IN `-1` FOR A REASON. S3 clients treat an ETag that looks like a hex digest as the
 *    MD5 of the object and check downloads against it; this drive has no MD5 of anything -- the
 *    bytes are encrypted before they leave the machine and the digest it does keep is a different
 *    function. The `-N` suffix is S3's own mark for "assembled from parts, not an MD5", and every
 *    client already knows to skip the check when it sees one. Without it a correct download is
 *    reported as corrupt.
 */
export function etagOf(entry) {
    const digest = createHash("sha256").update(`${entry.id}\n${entry.updatedAt}\n${entry.size}`).digest("hex");
    return `"${digest.slice(0, 32)}-1"`;
}
/** The tag of an object with no bytes: the MD5 of nothing, which is what S3 answers for one. */
export const EMPTY_ETAG = `"d41d8cd98f00b204e9800998ecf8427e"`;
/**
 * Two keys in the order S3 lists them, which is the order of their UTF-8 bytes.
 *
 * ⛔ NOT `<`. JavaScript compares UTF-16 code units, and those put a character above U+FFFF (most
 *    emoji) BEFORE one in U+E000–U+FFFF, where UTF-8 puts it after. A client that pages through a
 *    listing resumes after the last key it saw, so a listing in the other order skips keys or
 *    repeats them.
 */
export function compareKeys(a, b) {
    const shorter = Math.min(a.length, b.length);
    for (let i = 0; i < shorter;) {
        const x = a.codePointAt(i) ?? 0;
        const y = b.codePointAt(i) ?? 0;
        if (x !== y)
            return x < y ? -1 : 1;
        i += x > 0xffff ? 2 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
/** True for the key of a folder marker: it ends in `/`. */
export function isFolderKey(key) {
    return key.endsWith("/");
}
/**
 * Every live file in the account, and every live folder as its marker, as keys, in the order S3
 * promises: ascending by key.
 *
 * ⚠ A MARKER'S ENTRY IS THE FOLDER'S, WITH AN EMPTY `dekWrapped`. A folder has no key to open, and
 *   the reader refuses an entry with none; the empty string says "nothing to open", and the drive's
 *   own `fetch` answers a folder with no bytes before anything would try.
 */
export function objectsOf(entries) {
    const index = buildIndex(entries);
    const rows = [];
    for (const entry of entries) {
        if (!isLive(index, entry))
            continue;
        const key = fullPathOf(index, entry).replace(/^\//, "");
        const lastModified = new Date(entry.updatedAt).toISOString();
        if (entry.kind === KIND_FOLDER) {
            rows.push({ key: `${key}/`, lastModified, etag: EMPTY_ETAG, size: 0, entry: { ...entry, dekWrapped: "" } });
            continue;
        }
        rows.push({ key, lastModified, etag: etagOf(entry), size: entry.size, entry });
    }
    rows.sort((a, b) => compareKeys(a.key, b.key));
    return rows;
}
/** Every live folder, as a key ending in the delimiter — see the note at the top of this file. */
export function folderPrefixesOf(entries) {
    const index = buildIndex(entries);
    const out = [];
    for (const entry of entries) {
        if (entry.kind !== KIND_FOLDER)
            continue;
        if (!isLive(index, entry))
            continue;
        out.push(`${fullPathOf(index, entry).replace(/^\//, "")}/`);
    }
    return out;
}
/**
 * Apply prefix, delimiter and paging the way `ListObjects` does.
 *
 * The rules are S3's: a key is returned whole unless it holds the delimiter after the prefix, in
 * which case everything up to and including that delimiter becomes a common prefix and the key
 * itself is not listed. Common prefixes and keys share one page budget and one cursor.
 */
export function listObjects(objects, folders, query) {
    const maxKeys = Math.max(0, Math.min(query.maxKeys, MAX_KEYS_LIMIT));
    const seenPrefix = new Set();
    const rows = [];
    for (const object of objects) {
        if (!object.key.startsWith(query.prefix))
            continue;
        if (query.delimiter.length > 0) {
            const rest = object.key.slice(query.prefix.length);
            const at = rest.indexOf(query.delimiter);
            if (at >= 0) {
                const prefix = query.prefix + rest.slice(0, at + query.delimiter.length);
                if (!seenPrefix.has(prefix)) {
                    seenPrefix.add(prefix);
                    rows.push({ sort: prefix, row: null, prefix });
                }
                continue;
            }
        }
        rows.push({ sort: object.key, row: object, prefix: null });
    }
    // Folders that hold no listed file still belong in the answer — the note at the top says why.
    if (query.delimiter.length > 0) {
        for (const folder of folders) {
            if (!folder.startsWith(query.prefix))
                continue;
            const rest = folder.slice(query.prefix.length);
            const at = rest.indexOf(query.delimiter);
            if (at < 0)
                continue;
            const prefix = query.prefix + rest.slice(0, at + query.delimiter.length);
            if (seenPrefix.has(prefix))
                continue;
            seenPrefix.add(prefix);
            rows.push({ sort: prefix, row: null, prefix });
        }
    }
    rows.sort((a, b) => compareKeys(a.sort, b.sort));
    const after = query.after;
    const started = after === null ? rows : rows.filter((r) => compareKeys(r.sort, after) > 0);
    const page = started.slice(0, maxKeys);
    // ⚠ `max-keys=0` asks for nothing and is answered nothing, untruncated: S3's answer, and the only
    //   one a client can act on — "truncated" with no key to resume after has it ask again forever.
    const truncated = maxKeys > 0 && started.length > page.length;
    const last = page[page.length - 1];
    // ⛔ Split in a loop rather than two filter-and-map passes: a `map` over a filtered array cannot
    //    convince the type checker that the field is there, and the usual way round that is to invent
    //    an empty row for a case that cannot happen — which is how an empty key reaches a client.
    const contents = [];
    const commonPrefixes = [];
    for (const item of page) {
        if (item.row !== null)
            contents.push(item.row);
        else if (item.prefix !== null)
            commonPrefixes.push(item.prefix);
    }
    return {
        contents,
        commonPrefixes,
        truncated,
        next: truncated && last !== undefined ? last.sort : null,
    };
}
