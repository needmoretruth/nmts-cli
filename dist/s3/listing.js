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
// ⚠ ONE DELIBERATE DIFFERENCE FROM S3: a folder holding no files still comes back as a common
//   prefix. Real S3 has no folders, so an empty one cannot exist there; this drive does have them,
//   and hiding them would make `rclone lsd` describe a drive that is not the one in the browser.
import { buildIndex, fullPathOf, isLive, KIND_FOLDER } from "../drive-paths.js";
/** The one bucket. Named for what it is, and not configurable: two names for one drive is worse. */
export const BUCKET = "drive";
/** S3's own ceiling, and the default when a client does not ask for one. */
export const MAX_KEYS_LIMIT = 1000;
/**
 * An ETag that is stable for a file and changes when the file does.
 *
 * ⛔ IT ENDS IN `-1` FOR A REASON. S3 clients treat an ETag that looks like a hex digest as the
 *    MD5 of the object and check downloads against it; this drive has no MD5 of anything -- the
 *    bytes are encrypted before they leave the machine and the digest it does keep is a different
 *    function. The `-N` suffix is S3's own mark for "assembled from parts, not an MD5", and every
 *    client already knows to skip the check when it sees one. Without it a correct download is
 *    reported as corrupt.
 */
export function etagOf(entry) {
    const id = entry.id.replace(/[^0-9a-zA-Z]/g, "");
    const stamp = entry.updatedAt.toString(16);
    return `"${(id + stamp).slice(0, 32).padEnd(32, "0")}-1"`;
}
/** Every live file in the account, as keys, in the order S3 promises: ascending by key. */
export function objectsOf(entries) {
    const index = buildIndex(entries);
    const rows = [];
    for (const entry of entries) {
        if (entry.kind === KIND_FOLDER)
            continue;
        if (!isLive(index, entry))
            continue;
        rows.push({
            key: fullPathOf(index, entry).replace(/^\//, ""),
            lastModified: new Date(entry.updatedAt).toISOString(),
            etag: etagOf(entry),
            size: entry.size,
            entry,
        });
    }
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
    rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    const started = query.after === null ? rows : rows.filter((r) => r.sort > (query.after ?? ""));
    const page = started.slice(0, maxKeys);
    const truncated = started.length > page.length;
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
