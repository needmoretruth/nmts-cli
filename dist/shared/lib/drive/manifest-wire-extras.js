// NMF-1 — the parts of an entry's wire form that are not its core facts. ⚠ PUBLISHED — copied
// byte-for-byte into the `nmts` command-line package with the codec that imports it; keep comments
// self-contained English.
//
// Two things live here, apart from `manifest-codec.ts` only because that file is at its length
// ceiling: the share receipts (their own small wire shape) and the CARRY rule for keys this build
// does not know.
//
// THE CARRY RULE. An entry key this build has never heard of is kept verbatim on the entry and
//   written back on the next save. Before it, a key was dropped when read, so an older build that
//   SAVED rewrote every entry without the newer build's fields — a stale tab could clear stars,
//   labels and anything added later. ⚠ It protects only from THIS build onward: a build without
//   this rule still drops what it does not know. That is why every optional field must still be
//   safe to lose (see `MANIFEST_FORMAT_VERSION`).
export function sharesToWire(shares) {
    return shares.map((r) => (r.revoked ? { a: r.address, t: r.at, r: 1 } : { a: r.address, t: r.at }));
}
/**
 * Receipts that can be checked, or `undefined` when none can.
 *
 * Defensive for a sharp reason: a receipt with a blank address or a broken instant would be
 * compared against the server's rows and could produce a warning about a share nobody ever made.
 * Anything unusable is dropped — a receipt that cannot be checked says nothing, and saying nothing
 * is the honest outcome.
 */
export function sharesFromWire(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const clean = [];
    for (const item of raw) {
        if (!item || typeof item !== "object")
            continue;
        const a = "a" in item ? item.a : undefined;
        const t = "t" in item ? item.t : undefined;
        const r = "r" in item ? item.r : undefined;
        if (typeof a !== "string" || a === "")
            continue;
        if (typeof t !== "number" || !Number.isFinite(t))
            continue;
        clean.push(r === 1 ? { address: a, at: t, revoked: true } : { address: a, at: t });
    }
    return clean.length > 0 ? clean : undefined;
}
/**
 * Every entry key this build reads. ⛔ A key added to `WireEntry` and not here would ALSO be
 * carried, and a mark this build clears would come back from the carried copy on the next save —
 * the codec test pins the two lists together.
 */
export const KNOWN_ENTRY_KEYS = new Set([
    "i", "p", "k", "n", "s", "c", "u", "d", "w", "h", "f", "pn", "l", "sn", "sh", "to",
]);
/** The keys of a wire entry this build does not know, or `undefined` when there are none. */
export function carriedFromWire(w) {
    let carried;
    for (const [key, value] of Object.entries(w)) {
        if (KNOWN_ENTRY_KEYS.has(key))
            continue;
        (carried ??= {})[key] = value;
    }
    return carried;
}
/** `w` with the carried keys laid UNDER it — a key this build writes always wins over one it carries. */
export function withCarried(w, carried) {
    return carried ? { ...carried, ...w } : w;
}
