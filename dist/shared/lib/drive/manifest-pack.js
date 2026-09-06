// Placement and packing for the chunked file list — NCF-3 §6.3.3. ⚠ PUBLISHED — copied
// byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// WHAT THIS DECIDES: which entry goes in which chunk, and — for a save — which chunks can be kept
//   by name because nothing inside them moved. That second answer is the whole point of format
//   version 2: an edit that touches one file must upload one chunk, not the list.
//
// PURE: no I/O, no crypto, no React. It takes entries and the previous chunks and returns a plan;
//   sealing, naming and writing are `manifest-chunk-flow.ts`'s job.
//
// PLACEMENT IS THE WRITER'S DUTY AND THE READER'S CONVENIENCE. A reader must find an entry by
//   opening every chunk the index names; it MAY open the one whose range covers the folder on
//   screen first. So a writer that gets placement wrong has written a slow list, not a wrong one —
//   which is why the fallbacks below prefer "repack everything" over "refuse".
import { toWire } from "./manifest-codec.js";
import { buildIndex, pathOf } from "./manifest-index.js";
import { CHUNK_PLAIN_MAX } from "./manifest-chunks.js";
/**
 * The marker an entry gets when its parent chain does not reach the drive root.
 *
 * U+FFFF is a permanent noncharacter, so no name can contain it and it sorts after every assigned
 * character in both code-point and UTF-16 order. That is what puts "placed after every entry that
 * can be resolved" (§6.3.3) INSIDE the key, where any comparator honours it.
 */
export const UNRESOLVED_MARK = "\uFFFF";
/** Bytes for `{"v":2,"seq":<up to 16 digits>,"items":[]}` — the wrapper around a chunk's items. */
const CHUNK_DOC_OVERHEAD = 41;
const utf8 = new TextEncoder();
/** A key holding one half of a surrogate pair needs the slow, exact comparator below. */
const HAS_SURROGATE = /[\uD800-\uDFFF]/;
/**
 * The placement key of one entry: its folder path from the drive root, each segment the folder's
 * plaintext name, then the entry's own name, joined by `/`.
 *
 * Trashed entries keep the key they had — the trash is a mark on an entry, not a place — so
 * nothing here reads `deletedAt`.
 */
export function placementKey(entry, index) {
    const key = [...pathOf(index, entry), entry.name].join("/");
    return reachesRoot(index, entry) ? key : UNRESOLVED_MARK + key;
}
/** Whether this entry's parent chain ends at the root rather than at a gap or a loop. */
function reachesRoot(index, entry) {
    const seen = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId !== null) {
        if (seen.has(parentId))
            return false;
        seen.add(parentId);
        const parent = index.byId.get(parentId);
        if (!parent)
            return false;
        parentId = parent.parentId;
    }
    return true;
}
/**
 * Compare two placement keys BY CODE POINT, as §6.3.3 requires.
 *
 * JavaScript's own `<` compares UTF-16 code units, which puts an astral character (U+10000 and up,
 * stored as a surrogate pair starting at U+D800) BEFORE U+E000–U+FFFF instead of after it. That is
 * a different order from the one the format specifies, so keys carrying a surrogate take the exact
 * path; everything else takes the fast one, which is the same order for those strings.
 */
export function comparePlacementKeys(a, b) {
    if (a === b)
        return 0;
    if (!HAS_SURROGATE.test(a) && !HAS_SURROGATE.test(b))
        return a < b ? -1 : 1;
    const ca = Array.from(a);
    const cb = Array.from(b);
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i += 1) {
        const pa = ca[i]?.codePointAt(0) ?? 0;
        const pb = cb[i]?.codePointAt(0) ?? 0;
        if (pa !== pb)
            return pa < pb ? -1 : 1;
    }
    return ca.length - cb.length;
}
function keyAll(entries) {
    const index = buildIndex(entries);
    const keyed = entries.map((entry) => {
        const json = JSON.stringify(toWire(entry));
        const key = placementKey(entry, index);
        return { entry, key, json, bytes: utf8.encode(json).length, astral: HAS_SURROGATE.test(key) };
    });
    keyed.sort(order);
    return keyed;
}
/** Placement order, with the entry id as the tie-break so two same-named files never swap places. */
function order(a, b) {
    const byKey = a.astral || b.astral
        ? comparePlacementKeys(a.key, b.key)
        : a.key < b.key
            ? -1
            : a.key > b.key
                ? 1
                : 0;
    return byKey !== 0 ? byKey : a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
}
/** The plaintext a chunk holding exactly these entries would occupy. */
function sizeOf(items) {
    let total = CHUNK_DOC_OVERHEAD;
    for (const k of items)
        total += k.bytes + 1;
    return items.length === 0 ? CHUNK_DOC_OVERHEAD : total - 1;
}
/**
 * Pack every entry from scratch, in key order, closing a chunk when the next entry would push its
 * plaintext past the bound. Used for the first save of an account and for the version-1
 * conversion (§6.3.6).
 */
export function packAll(entries) {
    return close(fill(keyAll(entries)));
}
/** Greedy fill in key order — the "unused remainder is left unused" rule of §6.3.3. */
function fill(keyed) {
    const out = [];
    let current = [];
    let size = CHUNK_DOC_OVERHEAD;
    for (const k of keyed) {
        const next = size + k.bytes + (current.length === 0 ? 0 : 1);
        if (current.length > 0 && next > CHUNK_PLAIN_MAX) {
            out.push(current);
            current = [k];
            size = CHUNK_DOC_OVERHEAD + k.bytes;
            continue;
        }
        current.push(k);
        size = next;
    }
    if (current.length > 0)
        out.push(current);
    return out;
}
/** Turn buckets into the plan the flow writes, dropping any that ended up empty. */
function close(buckets, reuse = []) {
    const out = [];
    for (let i = 0; i < buckets.length; i += 1) {
        const items = buckets[i] ?? [];
        if (items.length === 0)
            continue;
        const name = reuse[i];
        out.push({
            ...(name ? { reuse: name } : {}),
            items: items.map((k) => k.entry),
            f: items[0]?.key ?? "",
            l: items[items.length - 1]?.key ?? "",
        });
    }
    return out;
}
/**
 * The minimal rewrite: keep every chunk whose entries came through the edit untouched, rewrite the
 * ones that changed, split what grew past the bound and merge what shrank under half of it.
 *
 * An entry stays in the chunk that held it only while its key is still inside that chunk's range.
 * A move between folders changes the key, so it leaves as a removal and arrives as an addition —
 * which is exactly the "at most two chunks" §6.3.3 describes.
 */
export function repack(previous, entries) {
    if (previous.length === 0)
        return packAll(entries);
    const keyed = keyAll(entries);
    const owner = new Map();
    for (let i = 0; i < previous.length; i += 1) {
        for (const e of previous[i]?.items ?? [])
            owner.set(e.id, i);
    }
    const buckets = previous.map(() => []);
    for (const k of keyed) {
        const held = owner.get(k.entry.id);
        const home = held !== undefined && inRange(k.key, previous[held]) ? held : covering(k.key, previous);
        buckets[home]?.push(k);
    }
    for (const bucket of buckets)
        bucket.sort(order);
    // ⚠ A previous index written by another build may have overlapping ranges, which the format
    // explicitly allows (§6.3.3). Bucketing by range would then interleave keys across chunks, so
    // the placement invariant is checked and a repack that would break it becomes a full repack —
    // slower for one save, and correct.
    if (!ordered(buckets))
        return packAll(entries);
    const reuse = buckets.map((bucket, i) => (unchanged(bucket, previous[i]) ? previous[i]?.h : undefined));
    return close(...merge(...split(buckets, reuse)));
}
/** Is this key inside the chunk's declared range? */
function inRange(key, chunk) {
    if (!chunk)
        return false;
    return comparePlacementKeys(key, chunk.f) >= 0 && comparePlacementKeys(key, chunk.l) <= 0;
}
/** The chunk this key belongs to: the last one whose range starts at or before it, else the first. */
function covering(key, previous) {
    let at = 0;
    for (let i = 0; i < previous.length; i += 1) {
        const f = previous[i]?.f;
        if (f !== undefined && comparePlacementKeys(f, key) <= 0)
            at = i;
    }
    return at;
}
/** Do the buckets, read end to end, still hold every entry in placement order? */
function ordered(buckets) {
    let last = null;
    for (const bucket of buckets) {
        for (const k of bucket) {
            if (last && order(last, k) > 0)
                return false;
            last = k;
        }
    }
    return true;
}
/** Same entries, same order, same bytes — the test for "this chunk can keep its name". */
function unchanged(bucket, chunk) {
    if (!chunk || bucket.length !== chunk.items.length || bucket.length === 0)
        return false;
    for (let i = 0; i < bucket.length; i += 1) {
        const before = chunk.items[i];
        if (!before || before.id !== bucket[i]?.entry.id)
            return false;
        if (JSON.stringify(toWire(before)) !== bucket[i]?.json)
            return false;
    }
    return true;
}
/** Split every bucket that outgrew the bound, at the median key, until each one fits. */
function split(buckets, reuse) {
    const outBuckets = [];
    const outReuse = [];
    for (let i = 0; i < buckets.length; i += 1) {
        const queue = [buckets[i] ?? []];
        let whole = true;
        while (queue.length > 0) {
            const bucket = queue.shift() ?? [];
            if (bucket.length > 1 && sizeOf(bucket) > CHUNK_PLAIN_MAX) {
                const at = Math.floor(bucket.length / 2);
                queue.unshift(bucket.slice(0, at), bucket.slice(at));
                whole = false;
                continue;
            }
            outBuckets.push(bucket);
            outReuse.push(whole ? reuse[i] : undefined);
        }
    }
    return [outBuckets, outReuse];
}
/**
 * Merge a chunk that fell under half the bound into the next one, when the pair fits.
 *
 * ⛔ BOTH SIDES HAVE TO BE UNDER HALF, which §6.3.3 does not say and this file adds. Without it a
 * chunk emptied by a delete would pull in a FULL neighbour whenever the two happened to fit, so
 * one removal would rewrite ~4 MiB of somebody else's untouched entries — the opposite of the
 * property chunking exists for. With it, small neighbours combine, a full chunk is never rewritten
 * because of its neighbour, and re-packing a freshly packed list changes nothing (the last chunk
 * is usually the only small one and it has no next).
 *
 * Left to right with the result re-examined, so a run of chunks emptied by a folder delete
 * collapses in one pass instead of leaving a trail of near-empty chunks behind.
 */
function merge(buckets, reuse) {
    const outBuckets = buckets.map((b) => b.slice());
    const outReuse = reuse.slice();
    const half = CHUNK_PLAIN_MAX / 2;
    let i = 0;
    while (i < outBuckets.length) {
        const here = outBuckets[i] ?? [];
        // A chunk whose every entry left simply stops existing. ⛔ Dropped BEFORE the merge below, or
        // it would be "merged" into its neighbour and cost that neighbour its name for nothing.
        if (here.length === 0) {
            outBuckets.splice(i, 1);
            outReuse.splice(i, 1);
            continue;
        }
        const next = outBuckets[i + 1];
        const fits = next !== undefined && sizeOf(here) + sizeOf(next) - CHUNK_DOC_OVERHEAD <= CHUNK_PLAIN_MAX;
        if (next !== undefined && fits && sizeOf(here) < half && sizeOf(next) < half) {
            outBuckets.splice(i, 2, [...here, ...next]);
            outReuse.splice(i, 2, undefined);
            continue;
        }
        i += 1;
    }
    return [outBuckets, outReuse];
}
