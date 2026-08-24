// The thirty days, on the half of the trash this tool owns.
//
// ⛔ THE KEY THAT OPENS A FILE EXISTS TWICE, AND EACH SIDE SWEEPS ITS OWN COPY. One copy is the
//    item row on the server; the other is `dekWrapped` inside the sealed file list, which the
//    server cannot read and therefore cannot edit. Erasing one and leaving the other is not a
//    deletion — it is a deletion somebody was told about while a working key stayed behind. So the
//    server sweeps its rows on a timer, and a signed-in client drops the matching list entries.
//
// ⛔ THIS TOOL CANNOT DO THE SERVER'S HALF, and that is a deliberate line rather than a gap: the
//    endpoint that erases for good refuses an API key outright, because a soft delete is
//    recoverable and an erase is not. What is left for this side is to drop list entries for
//    things the server has ALREADY let go of — which is why the sweep asks what the server still
//    holds before it writes anything, and holds back what it finds.
//
// ⛔ AND IT DROPS WHOLE BRANCHES OR NOTHING. Trashing a folder marks the folder alone; everything
//    under it is trash by inheritance and shares the folder's instant. Drop the folder while one
//    file under it is held back and that file's parent chain breaks — after which nothing carries
//    a `deletedAt` above it any more, so it reads as LIVE, is never swept again, and `ls` prints
//    it as a file the server has already erased the key for. That is the one state this tool is
//    built to avoid, and it is reachable from an ordinary half-finished sweep, so the plan below
//    keeps every ancestor of anything it keeps.
//
// PURE: no network and no clock of its own. The server's answer and the current time both arrive
// as arguments, so `node --test` can put this in states a real account takes a month to reach.

import { KIND_FILE, trashedAt, type ManifestIndex } from "./drive-paths.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";

const DAY_MS = 86_400_000;

/**
 * How long a trashed item stays restorable.
 *
 * ⛔ It must match the browser's `web/src/lib/drive/manifest-views.ts::TRASH_RETENTION_DAYS`, and
 *    both of those describe the same promise the server enforces on its own rows. A tool that
 *    counted to a different number would either drop an entry whose file the person could still
 *    have restored, or leave one behind for a file whose key the server had already destroyed.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Whole days left of the thirty, counting up rather than down.
 *
 * Rounded UP so a row with four hours left says "1 day left" rather than "0 days left" — the
 * number is what somebody decides whether to restore on, and rounding it to nothing reads as
 * "already gone".
 */
export function daysLeftInTrash(trashedAtMs: number, nowMs: number): number {
  return Math.ceil((trashedAtMs + TRASH_RETENTION_DAYS * DAY_MS - nowMs) / DAY_MS);
}

/**
 * Entries whose thirty days have run out.
 *
 * Measured from the INHERITED instant, so a file inside a trashed folder is measured from the
 * moment the folder was thrown away — which is also the moment the server stamped on its row.
 * Reading each entry's own `deletedAt` would leave every file under a swept folder in the list.
 */
export function expiredTrashEntries(index: ManifestIndex, nowMs: number): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const entry of index.all) {
    const at = trashedAt(index, entry);
    if (at === null) continue;
    // ⚠ SUBTRACTION, NOT A DISTANCE. An instant in the FUTURE is a clock that was corrected
    //   backwards rather than an expiry, and it falls out here because the difference goes
    //   negative. Anything that measured how far apart the two are instead would sweep it, which
    //   destroys a key thirty days early on a machine whose date is simply wrong.
    if (nowMs - at >= TRASH_RETENTION_DAYS * DAY_MS) out.push(entry);
  }
  return out;
}

/** What one sweep may do, and what it must not do yet. */
export interface PurgePlan {
  /** Entries that may leave the file list now. */
  drop: readonly ManifestEntry[];
  /** Expired entries the server has not let go of yet. Nothing is wrong; it sweeps on a timer. */
  waiting: readonly ManifestEntry[];
  /** Expired entries held only because something underneath them is being kept. */
  tangled: readonly ManifestEntry[];
}

/**
 * Split the expired entries into what may go and what may not.
 *
 * `stillOnServer` is every item id the server still has a row for, live or trashed. An id in that
 * set has a key the server has not destroyed, so dropping this side's copy would hide a file that
 * is still stored and still being paid for.
 *
 * ⚠ Folder entries never appear in that set — the server holds no row for a folder — so a folder
 *   is held back only by the branch rule below, which is exactly when it should be.
 */
export function planPurge(
  index: ManifestIndex,
  expired: readonly ManifestEntry[],
  stillOnServer: ReadonlySet<string>,
): PurgePlan {
  const going = new Set(expired.map((e) => e.id));
  const waiting: ManifestEntry[] = [];
  for (const entry of expired) {
    if (!stillOnServer.has(entry.id)) continue;
    going.delete(entry.id);
    waiting.push(entry);
  }

  // ⛔ Everything ABOVE anything that stays has to stay as well — see the header. Walking up from
  //    every entry that is not going covers it whatever order they come in: removing an ancestor
  //    only ever adds to the set of things that stay, and the walk that removed it carries on to
  //    the root, so the entries it removes on the way are covered by the same pass.
  for (const entry of index.all) {
    if (going.has(entry.id)) continue;
    let parentId = entry.parentId;
    const seen = new Set<string>([entry.id]);
    while (parentId !== null) {
      if (seen.has(parentId)) break;
      seen.add(parentId);
      going.delete(parentId);
      const parent = index.byId.get(parentId);
      if (parent === undefined) break;
      parentId = parent.parentId;
    }
  }

  const held = new Set(waiting.map((e) => e.id));
  return {
    drop: expired.filter((e) => going.has(e.id)),
    waiting,
    tangled: expired.filter((e) => !going.has(e.id) && !held.has(e.id)),
  };
}

/**
 * How many of the entries about to be dropped hold bytes.
 *
 * Said out loud before the write, because a count of ENTRIES reads as harmless — most of a trashed
 * branch is folders, which hold nothing at all — and the number that matters is how many keys are
 * being destroyed.
 */
export function filesAmong(entries: readonly ManifestEntry[]): number {
  return entries.filter((e) => e.kind === KIND_FILE).length;
}
