// Drive edits expressed as INTENT, and how an intent lands on a list. ⚠ PUBLISHED — copied
// byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// WHY INTENT AND NOT BYTES: the sealed list is written with compare-and-swap on its version, so a
//   second device writing first turns our save into a 409. Recovering from that means re-applying
//   what the person *meant* onto the version we just learned about. Holding the finished bytes
//   makes that impossible — the only options left would be "clobber their change" or "lose ours".
//   Holding intents makes both edits survive with nothing the user has to see or decide.
//
// THEREFORE EVERY OPERATION HERE MUST BE REPLAYABLE onto a list it was not built against:
//   * addressed by id, never by position;
//   * a target that has since vanished is a NO-OP, never a resurrection — the other device
//     deleting it is newer information than our rename;
//   * applying twice equals applying once, because a retry may re-send an intent that landed.
//
// TRASH IS ONE FLAG PER ITEM, NOT A SUBTREE STAMP. Trashing a folder marks only the folder; a
//   child counts as trashed when it or any ancestor is (manifest-index.ts). Stamping every
//   descendant would reset each child's own 30-day clock and, worse, make "restore" ambiguous —
//   a file the person had trashed last week would come back alive with its parent.
//
// CLOCKS: every instant in a manifest comes from the browser that wrote it. Never compare one
//   against a server timestamp (`GET /v1/objects`, item rows): those come from the database clock
//   and the two only agree by accident. Reconciliation matches on id.
import type { AccountSettings, ManifestEntry, ShareReceipt } from "./manifest-codec.ts";
// Runtime import (relative + .ts — the header's node --test rule) for the bounds the patch obeys.
import {
  TEXT_SCALE_DEFAULT_PCT,
  TEXT_SCALE_MAX_PCT,
  TEXT_SCALE_MIN_PCT,
} from "./manifest-codec.ts";

/** One drive edit, in a form that can be replayed onto a newer list. */
export type ManifestIntent =
  /** Insert or replace by id. Upload-commit and folder-create both land here. */
  | { op: "add"; entry: ManifestEntry }
  /** New plaintext name for one item. */
  | { op: "rename"; id: string; name: string; at: number }
  /** New parent (null = drive root). */
  | { op: "move"; id: string; parentId: string | null; at: number }
  /** Send to the trash. Already-trashed ids keep their original instant. */
  | { op: "trash"; ids: readonly string[]; at: number }
  /** Bring back out of the trash. */
  | { op: "restore"; ids: readonly string[]; at: number }
  /** Remove from the list entirely — the storage record is gone or going. */
  | { op: "purge"; ids: readonly string[] }
  /** Star / unstar. `on` is the DESIRED state, never a toggle: a replayed toggle would flip twice. */
  | { op: "favorite"; ids: readonly string[]; on: boolean; at: number }
  /** Pin / unpin to the top of the item's own folder. Same desired-state rule as favourite. */
  | { op: "pin"; ids: readonly string[]; on: boolean; at: number }
  /** Put one label on (or take it off) these items. */
  | { op: "label"; ids: readonly string[]; label: string; on: boolean; at: number }
  /** Rename a label everywhere it appears. Items already wearing `to` do not gain a duplicate. */
  | { op: "labelRename"; from: string; to: string; at: number }
  /** Remove a label from every item — which is what makes it stop existing. */
  | { op: "labelDelete"; label: string; at: number }
  /**
   * Write MY OWN receipt that this file was shared with this address.
   *
   * Upsert by address, because the server replaces rather than stacks a re-share to the same
   * person (`shares_one_per_recipient`); a second receipt would show one recipient twice.
   */
  | { op: "shareRecord"; id: string; address: string; at: number }
  /** Mark a receipt as revoked — a revocation was sent. No-op when there is no receipt for that address. */
  | { op: "shareRevoked"; id: string; address: string; at: number }
  /**
   * Drop receipts the server's listing has confirmed gone.
   *
   * ⛔ ONLY REVOKED RECEIPTS ARE DROPPED. An active receipt whose row is missing is the entire
   * point of keeping receipts — pruning it would erase the warning instead of showing it — and
   * the restriction is also what makes this intent safe to replay onto a list where the address
   * was just re-shared.
   */
  | { op: "sharePrune"; id: string; addresses: readonly string[]; at: number };

/**
 * Apply one intent, returning a new list. The input is never mutated: the store keeps the
 * pre-save snapshot around to rebuild from after a version conflict.
 *
 * Returns the SAME array reference when nothing changed, so callers can skip a re-render and a
 * save for an intent that turned out to be a no-op (a rename to the name it already had, a trash
 * of something another device already purged).
 */
export function applyIntent(
  entries: readonly ManifestEntry[],
  intent: ManifestIntent,
): readonly ManifestEntry[] {
  switch (intent.op) {
    case "add":
      return upsert(entries, intent.entry);
    case "rename":
      return patchOne(entries, intent.id, (e) =>
        e.name === intent.name ? e : { ...e, name: intent.name, updatedAt: intent.at },
      );
    case "move":
      return patchOne(entries, intent.id, (e) =>
        e.parentId === intent.parentId
          ? e
          : { ...e, parentId: intent.parentId, updatedAt: intent.at },
      );
    case "trash": {
      const ids = new Set(intent.ids);
      // `deletedAt` is left alone when already set: it is the start of the retention window the
      // UI promises ("restorable for 30 days"), and re-stamping it would quietly extend that.
      return patchMany(entries, ids, (e) =>
        e.deletedAt !== undefined ? e : { ...e, deletedAt: intent.at, updatedAt: intent.at },
      );
    }
    case "restore": {
      const ids = new Set(intent.ids);
      return patchMany(entries, ids, (e) => {
        if (e.deletedAt === undefined) return e;
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
      if (label === "") return entries;
      const ids = new Set(intent.ids);
      return patchMany(entries, ids, (e) => {
        const has = (e.labels ?? []).includes(label);
        if (has === intent.on) return e;
        const next = intent.on
          ? [...(e.labels ?? []), label]
          : (e.labels ?? []).filter((l) => l !== label);
        return withLabels(e, next, intent.at);
      });
    }
    case "labelRename": {
      const from = intent.from.trim();
      const to = intent.to.trim();
      if (from === "" || to === "" || from === to) return entries;
      return patchAll(entries, (e) => {
        if (!(e.labels ?? []).includes(from)) return e;
        // Renaming ONTO an existing label merges the two rather than leaving one item wearing the
        // same label twice — which would show a doubled row and count every file twice.
        const next = (e.labels ?? []).filter((l) => l !== from);
        if (!next.includes(to)) next.push(to);
        return withLabels(e, next, intent.at);
      });
    }
    case "labelDelete": {
      const label = intent.label.trim();
      if (label === "") return entries;
      return patchAll(entries, (e) => {
        if (!(e.labels ?? []).includes(label)) return e;
        return withLabels(e, (e.labels ?? []).filter((l) => l !== label), intent.at);
      });
    }
    case "shareRecord": {
      const address = intent.address.trim();
      if (address === "") return entries;
      return patchOne(entries, intent.id, (e) => {
        const existing = (e.shares ?? []).find((r) => r.address === address);
        // A re-share of the same file to the same person REVIVES the receipt: the row is live
        // again, so a revoked mark left over from before would report a lingering row that is now
        // exactly what the sender asked for.
        if (existing && existing.revoked !== true) return e;
        const others = (e.shares ?? []).filter((r) => r.address !== address);
        return withShares(e, [...others, { address, at: intent.at }], intent.at);
      });
    }
    case "shareRevoked": {
      const address = intent.address.trim();
      if (address === "") return entries;
      return patchOne(entries, intent.id, (e) => {
        const receipts = e.shares ?? [];
        if (!receipts.some((r) => r.address === address && r.revoked !== true)) return e;
        return withShares(
          e,
          receipts.map((r) => (r.address === address ? { ...r, revoked: true as const } : r)),
          intent.at,
        );
      });
    }
    case "sharePrune": {
      const addresses = new Set(intent.addresses);
      if (addresses.size === 0) return entries;
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
function setMark(
  e: ManifestEntry,
  key: "favorite" | "pinned",
  on: boolean,
  at: number,
): ManifestEntry {
  if (on === (e[key] === true)) return e;
  if (on) return { ...e, [key]: true, updatedAt: at };
  const next = { ...e, updatedAt: at };
  delete next[key];
  return next;
}

/** Replace an item's label list, dropping the field entirely when nothing is left. */
function withLabels(e: ManifestEntry, labels: string[], at: number): ManifestEntry {
  if (labels.length === 0) {
    const next = { ...e, updatedAt: at };
    delete next.labels;
    return next;
  }
  return { ...e, labels, updatedAt: at };
}

/** Replace an item's share receipts, dropping the field entirely when nothing is left. */
function withShares(
  e: ManifestEntry,
  shares: ShareReceipt[],
  at: number,
): ManifestEntry {
  if (shares.length === 0) {
    const next = { ...e, updatedAt: at };
    delete next.shares;
    return next;
  }
  return { ...e, shares, updatedAt: at };
}

/**
 * One account-settings edit, as DESIRED STATE per field.
 *
 * Same replay discipline as the intents above: a patch says what the field should BE, never
 * "toggle", so replaying it onto a list another device wrote lands the same answer. `false` /
 * `100` mean "back to the default", which the codec spells as absence.
 */
/**
 * Which size-padding rule an account seals its next upload under.
 *
 * ⛔ DECLARED BESIDE THE PATCH THAT CARRIES IT, not in `lib/crypto/padding.ts` where the padding
 *    itself lives. `padding.ts` imports it from here. The direction matters: this file is copied
 *    byte-for-byte into the `nmts` command-line package, and a type reaching out of it into the
 *    crypto tree would drag that whole tree along with it for the sake of two string literals.
 */
export type PaddingMode = "padme" | "pow2";

export interface SettingsPatch {
  developerMode?: boolean;
  textScalePct?: number;
  /** Which size-padding rule to seal future uploads under. `"padme"` = the default. */
  paddingMode?: PaddingMode;
}

/**
 * Apply one settings patch, returning new settings. Returns the SAME reference when nothing
 * changed, so callers can skip a save (a version bump every other device must download).
 *
 * A text scale is CLAMPED into the codec's bounds here — this is the one write path, so a value
 * the slider or the typed field lets through never reaches the wire out of range.
 */
export function applySettingsPatch(
  settings: AccountSettings,
  patch: SettingsPatch,
): AccountSettings {
  const next: AccountSettings = { ...settings };
  if (patch.developerMode !== undefined) {
    if (patch.developerMode) next.developerMode = true;
    else delete next.developerMode;
  }
  if (patch.paddingMode !== undefined) {
    // The default is spelled as absence, like every other field here — so two devices that both
    // "choose the default" write the same bytes and neither bumps the list's version.
    if (patch.paddingMode === "pow2") next.paddingMode = "pow2";
    else delete next.paddingMode;
  }
  if (patch.textScalePct !== undefined && Number.isFinite(patch.textScalePct)) {
    const pct = Math.round(
      Math.min(TEXT_SCALE_MAX_PCT, Math.max(TEXT_SCALE_MIN_PCT, patch.textScalePct)),
    );
    if (pct === TEXT_SCALE_DEFAULT_PCT) delete next.textScalePct;
    else next.textScalePct = pct;
  }
  const same =
    (next.developerMode === true) === (settings.developerMode === true) &&
    next.paddingMode === settings.paddingMode &&
    next.textScalePct === settings.textScalePct;
  return same ? settings : next;
}

/** Replay a whole queue in order. Used to rebuild after a version conflict. */
export function applyIntents(
  entries: readonly ManifestEntry[],
  intents: readonly ManifestIntent[],
): readonly ManifestEntry[] {
  return intents.reduce<readonly ManifestEntry[]>(applyIntent, entries);
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
export function mustSaveNow(intent: ManifestIntent): boolean {
  return (
    intent.op === "add" ||
    intent.op === "trash" ||
    intent.op === "purge" ||
    intent.op === "shareRecord" ||
    intent.op === "shareRevoked"
  );
}

function upsert(
  entries: readonly ManifestEntry[],
  entry: ManifestEntry,
): readonly ManifestEntry[] {
  const at = entries.findIndex((e) => e.id === entry.id);
  if (at < 0) return [...entries, entry];
  const next = entries.slice();
  next[at] = entry;
  return next;
}

function patchOne(
  entries: readonly ManifestEntry[],
  id: string,
  patch: (e: ManifestEntry) => ManifestEntry,
): readonly ManifestEntry[] {
  // ⚠ FOUND BY VALUE, NOT BY INDEX. `entries[at]` after a `findIndex` is provably present and the
  //    compiler cannot know it — which is fine here and NOT fine in the copy of this file that
  //    ships inside the `nmts` command, where `noUncheckedIndexedAccess` is on. Reaching for the
  //    element itself needs no assertion in either build.
  const found = entries.find((e) => e.id === id);
  // Absent = another device removed it. Adding it back would undo a deletion the person made.
  if (found === undefined) return entries;
  const updated = patch(found);
  if (updated === found) return entries;
  return entries.map((e) => (e === found ? updated : e));
}

/** Patch every entry the callback changes. Used by the label sweeps, which are not id-addressed. */
function patchAll(
  entries: readonly ManifestEntry[],
  patch: (e: ManifestEntry) => ManifestEntry,
): readonly ManifestEntry[] {
  let changed = false;
  const next = entries.map((e) => {
    const updated = patch(e);
    if (updated !== e) changed = true;
    return updated;
  });
  return changed ? next : entries;
}

function patchMany(
  entries: readonly ManifestEntry[],
  ids: ReadonlySet<string>,
  patch: (e: ManifestEntry) => ManifestEntry,
): readonly ManifestEntry[] {
  let changed = false;
  const next = entries.map((e) => {
    if (!ids.has(e.id)) return e;
    const updated = patch(e);
    if (updated !== e) changed = true;
    return updated;
  });
  return changed ? next : entries;
}
