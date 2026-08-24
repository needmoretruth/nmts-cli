// Give an uploaded file a name that is not already in use in its destination folder —
// `report.pdf` → `report (2).pdf`. ⚠ PUBLISHED — copied byte-for-byte into the `nmts` command-line
// package; keep comments self-contained English.
//
// WHY THIS INSTEAD OF OVERWRITING: the alternative on the table was
//   "same name replaces the old file". Replacing destroys data that cannot be got back — NMTS
//   keeps no previous versions, so an accidental same-name upload would be permanent loss — and
//   keeping previous versions would mean paying Walrus storage for every generation, out of the
//   user's own wallet. Suffixing costs nothing, loses nothing, and is what every desktop does.
//
// EXACT-MATCH COMPARISON, deliberately: the drive treats `A.txt` and `a.txt` as two files, so this
//   must too, or uploading `a.txt` next to an existing `A.txt` would rename a file the user can
//   see is differently named. Case-insensitive filesystems are handled at the other end — the bulk
//   download's `freeName()` already suffixes on collision when writing to disk.
//
// WHERE THE TAKEN SET COMES FROM: the account's sealed file list, in memory (`namesIn`). It used
//   to be one server listing per destination folder, decrypted name by name — which could FAIL,
//   and a failed name check had to refuse the upload outright. That whole failure mode is gone.
//
// Pure: no imports at all, so `node --test` covers it directly.

/** Where the extension starts, or -1. A leading dot is part of the name, not a separator. */
function extIndex(filename: string): number {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? dot : -1;
}

/**
 * A name not present in `taken`.
 *
 * Returns `desired` untouched when it is free. Otherwise inserts ` (n)` before the extension,
 * starting at 2, until it finds a free one — matching desktop behaviour so nobody has to learn a
 * new convention. `taken` is not mutated; callers uploading several files at once must add each
 * returned name themselves, or a batch of identical names would all resolve to the same `(2)`.
 */
export function uniqueFileName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired;

  const dot = extIndex(desired);
  const stem = dot === -1 ? desired : desired.slice(0, dot);
  const ext = dot === -1 ? "" : desired.slice(dot);

  // Bounded: an unbounded loop here would hang the upload rather than fail it. 10k duplicates of
  // one name in one folder is far past any real use, and the timestamp fallback is still unique.
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${new Date().toISOString().replace(/[:.]/g, "-")})${ext}`;
}
