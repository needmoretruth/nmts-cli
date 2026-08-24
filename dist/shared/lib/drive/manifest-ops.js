// Runtime import (relative + .ts — the header's node --test rule) for the bounds the patch obeys.
import { TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT, } from "./manifest-codec.js";
/**
 * Apply one intent, returning a new list. The input is never mutated: the store keeps the
 * pre-save snapshot around to rebuild from after a version conflict.
 *
 * Returns the SAME array reference when nothing changed, so callers can skip a re-render and a
 * save for an intent that turned out to be a no-op (a rename to the name it already had, a trash
 * of something another device already purged).
 */
export function applyIntent(entries, intent) {
    switch (intent.op) {
        case "add":
            return upsert(entries, intent.entry);
        case "rename":
            return patchOne(entries, intent.id, (e) => e.name === intent.name ? e : { ...e, name: intent.name, updatedAt: intent.at });
        case "move":
            return patchOne(entries, intent.id, (e) => e.parentId === intent.parentId
                ? e
                : { ...e, parentId: intent.parentId, updatedAt: intent.at });
        case "trash": {
            const ids = new Set(intent.ids);
            // `deletedAt` is left alone when already set: it is the start of the retention window the
            // UI promises ("restorable for 30 days"), and re-stamping it would quietly extend that.
            return patchMany(entries, ids, (e) => e.deletedAt !== undefined ? e : { ...e, deletedAt: intent.at, updatedAt: intent.at });
        }
        case "restore": {
            const ids = new Set(intent.ids);
            return patchMany(entries, ids, (e) => {
                if (e.deletedAt === undefined)
                    return e;
                const { deletedAt: _dropped, ...rest } = e;
                return { ...rest, updatedAt: intent.at };
            });
        }
        case "purge": {
            const ids = new Set(intent.ids);
            const kept = entries.filter((e) => !ids.has(e.id));
            return kept.length === entries.length ? entries : kept;
        }
        case "favorite": {
            const ids = new Set(intent.ids);
            return patchMany(entries, ids, (e) => setMark(e, "favorite", intent.on, intent.at));
        }
        case "pin": {
            const ids = new Set(intent.ids);
            return patchMany(entries, ids, (e) => setMark(e, "pinned", intent.on, intent.at));
        }
        case "label": {
            const label = intent.label.trim();
            if (label === "")
                return entries;
            const ids = new Set(intent.ids);
            return patchMany(entries, ids, (e) => {
                const has = (e.labels ?? []).includes(label);
                if (has === intent.on)
                    return e;
                const next = intent.on
                    ? [...(e.labels ?? []), label]
                    : (e.labels ?? []).filter((l) => l !== label);
                return withLabels(e, next, intent.at);
            });
        }
        case "labelRename": {
            const from = intent.from.trim();
            const to = intent.to.trim();
            if (from === "" || to === "" || from === to)
                return entries;
            return patchAll(entries, (e) => {
                if (!(e.labels ?? []).includes(from))
                    return e;
                // Renaming ONTO an existing label merges the two rather than leaving one item wearing the
                // same label twice — which would show a doubled row and count every file twice.
                const next = (e.labels ?? []).filter((l) => l !== from);
                if (!next.includes(to))
                    next.push(to);
                return withLabels(e, next, intent.at);
            });
        }
        case "labelDelete": {
            const label = intent.label.trim();
            if (label === "")
                return entries;
            return patchAll(entries, (e) => {
                if (!(e.labels ?? []).includes(label))
                    return e;
                return withLabels(e, (e.labels ?? []).filter((l) => l !== label), intent.at);
            });
        }
        case "shareRecord": {
            const address = intent.address.trim();
            if (address === "")
                return entries;
            return patchOne(entries, intent.id, (e) => {
                const existing = (e.shares ?? []).find((r) => r.address === address);
                // A re-share of the same file to the same person REVIVES the receipt: the row is live
                // again, so a revoked mark left over from before would report a lingering row that is now
                // exactly what the sender asked for.
                if (existing && existing.revoked !== true)
                    return e;
                const others = (e.shares ?? []).filter((r) => r.address !== address);
                return withShares(e, [...others, { address, at: intent.at }], intent.at);
            });
        }
        case "shareRevoked": {
            const address = intent.address.trim();
            if (address === "")
                return entries;
            return patchOne(entries, intent.id, (e) => {
                const receipts = e.shares ?? [];
                if (!receipts.some((r) => r.address === address && r.revoked !== true))
                    return e;
                return withShares(e, receipts.map((r) => (r.address === address ? { ...r, revoked: true } : r)), intent.at);
            });
        }
        case "sharePrune": {
            const addresses = new Set(intent.addresses);
            if (addresses.size === 0)
                return entries;
            return patchOne(entries, intent.id, (e) => {
                const receipts = e.shares ?? [];
                const kept = receipts.filter((r) => !(r.revoked === true && addresses.has(r.address)));
                return kept.length === receipts.length ? e : withShares(e, kept, intent.at);
            });
        }
    }
}
/**
 * Set or clear one boolean mark, keeping "absent" as the only spelling of false.
 *
 * Writing `favorite: false` would be a second spelling of the same fact, and it would ride in
 * every save for every item the person ever un-starred.
 */
function setMark(e, key, on, at) {
    if (on === (e[key] === true))
        return e;
    if (on)
        return { ...e, [key]: true, updatedAt: at };
    const next = { ...e, updatedAt: at };
    delete next[key];
    return next;
}
/** Replace an item's label list, dropping the field entirely when nothing is left. */
function withLabels(e, labels, at) {
    if (labels.length === 0) {
        const next = { ...e, updatedAt: at };
        delete next.labels;
        return next;
    }
    return { ...e, labels, updatedAt: at };
}
/** Replace an item's share receipts, dropping the field entirely when nothing is left. */
function withShares(e, shares, at) {
    if (shares.length === 0) {
        const next = { ...e, updatedAt: at };
        delete next.shares;
        return next;
    }
    return { ...e, shares, updatedAt: at };
}
/**
 * Apply one settings patch, returning new settings. Returns the SAME reference when nothing
 * changed, so callers can skip a save (a version bump every other device must download).
 *
 * A text scale is CLAMPED into the codec's bounds here — this is the one write path, so a value
 * the slider or the typed field lets through never reaches the wire out of range.
 */
export function applySettingsPatch(settings, patch) {
    const next = { ...settings };
    if (patch.developerMode !== undefined) {
        if (patch.developerMode)
            next.developerMode = true;
        else
            delete next.developerMode;
    }
    if (patch.paddingMode !== undefined) {
        // The default is spelled as absence, like every other field here — so two devices that both
        // "choose the default" write the same bytes and neither bumps the list's version.
        if (patch.paddingMode === "pow2")
            next.paddingMode = "pow2";
        else
            delete next.paddingMode;
    }
    if (patch.textScalePct !== undefined && Number.isFinite(patch.textScalePct)) {
        const pct = Math.round(Math.min(TEXT_SCALE_MAX_PCT, Math.max(TEXT_SCALE_MIN_PCT, patch.textScalePct)));
        if (pct === TEXT_SCALE_DEFAULT_PCT)
            delete next.textScalePct;
        else
            next.textScalePct = pct;
    }
    const same = (next.developerMode === true) === (settings.developerMode === true) &&
        next.paddingMode === settings.paddingMode &&
        next.textScalePct === settings.textScalePct;
    return same ? settings : next;
}
/** Replay a whole queue in order. Used to rebuild after a version conflict. */
export function applyIntents(entries, intents) {
    return intents.reduce(applyIntent, entries);
}
/**
 * True when the intent touches storage the server also tracks, so a save must not be deferred.
 *
 * A queued save that dies with the tab is recoverable for a rename (the name is only in the
 * manifest, and losing it leaves the old name — annoying, not damaging). It is NOT recoverable
 * when a file was just committed or just deleted: the storage record moved, and a manifest that
 * disagrees leaves a file that is paid for but invisible, or one that shows but is gone.
 *
 * Stars, pins and labels are deliberately NOT in this list: they exist only in the manifest, so the
 * worst a lost save can do is leave a file unstarred — the same recoverable loss as a rename.
 *
 * SHARE RECEIPTS ARE, for the same reason a commit is: they describe a row the server now
 * holds, and nothing else on this side records it. A receipt lost with the tab does not degrade to
 * a wrong colour — it degrades to a share this device can never again hold the server to.
 * `sharePrune` stays out: losing it leaves a settled receipt that the next listing prunes again.
 */
export function mustSaveNow(intent) {
    return (intent.op === "add" ||
        intent.op === "trash" ||
        intent.op === "purge" ||
        intent.op === "shareRecord" ||
        intent.op === "shareRevoked");
}
function upsert(entries, entry) {
    const at = entries.findIndex((e) => e.id === entry.id);
    if (at < 0)
        return [...entries, entry];
    const next = entries.slice();
    next[at] = entry;
    return next;
}
function patchOne(entries, id, patch) {
    // ⚠ FOUND BY VALUE, NOT BY INDEX. `entries[at]` after a `findIndex` is provably present and the
    //    compiler cannot know it — which is fine here and NOT fine in the copy of this file that
    //    ships inside the `nmts` command, where `noUncheckedIndexedAccess` is on. Reaching for the
    //    element itself needs no assertion in either build.
    const found = entries.find((e) => e.id === id);
    // Absent = another device removed it. Adding it back would undo a deletion the person made.
    if (found === undefined)
        return entries;
    const updated = patch(found);
    if (updated === found)
        return entries;
    return entries.map((e) => (e === found ? updated : e));
}
/** Patch every entry the callback changes. Used by the label sweeps, which are not id-addressed. */
function patchAll(entries, patch) {
    let changed = false;
    const next = entries.map((e) => {
        const updated = patch(e);
        if (updated !== e)
            changed = true;
        return updated;
    });
    return changed ? next : entries;
}
function patchMany(entries, ids, patch) {
    let changed = false;
    const next = entries.map((e) => {
        if (!ids.has(e.id))
            return e;
        const updated = patch(e);
        if (updated !== e)
            changed = true;
        return updated;
    });
    return changed ? next : entries;
}
