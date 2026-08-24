// What an account is holding, worked out from the decrypted list and nothing else.
//
// ⛔ EVERY NUMBER IS EXACT, NOT ESTIMATED. The sealed list IS the drive — it is what every device
//    reads to know what exists — so counting it is counting the account. Nothing here samples,
//    rounds or asks the server: the server holds sizes and times, and the names and the tree it
//    cannot read at all, so "how many folders do I have" has no server-side answer to fetch.
//
// ⛔ THE TRASH IS COUNTED SEPARATELY AND KEPT OUT OF THE TOTAL. The two figures answer different
//    questions: the total is what the drive holds, and the trash figure is what is still stored
//    and still paid for while being no longer in the drive. Folding them together would tell
//    somebody who just deleted 4 GB that nothing changed; leaving the trash out silently would
//    tell them the 4 GB is gone when the storage is still bought. It is the same split the account
//    screen in a browser shows, and for the same reason.
//
// ⚠ IT COUNTS PLAINTEXT BYTES — what the files hold. What the storage network holds for the
//   account is larger: sealing adds bytes to every file, and storage is bought in fixed units.
//   This is not a bill, and nothing here should be printed as one.

import { fullPathOf, isLive, KIND_FILE, type ManifestIndex } from "./drive-paths.ts";
import { totalsOf } from "./shared/lib/drive/manifest-index.ts";

/** How many of the largest files a report carries. */
export const BIGGEST_SHOWN = 5;

/** One of the largest files, with enough to go and fetch it. */
export interface BiggestFile {
  id: string;
  name: string;
  /** The whole path, exactly as `ls` prints it and `get` accepts it. */
  path: string;
  size: number;
}

export interface UsageReport {
  /** Live files. Folders hold nothing, so they are not in this. */
  files: number;
  /** Live folders. */
  folders: number;
  /** Plaintext bytes of the live files. */
  bytes: number;
  /** Files sitting in the trash — still stored, still paid for. */
  trashedFiles: number;
  /** Plaintext bytes held by those — the figure that explains "deleting did not free anything". */
  trashedBytes: number;
  /** The largest live files, largest first. At most `BIGGEST_SHOWN` of them. */
  biggest: BiggestFile[];
}

/**
 * The whole report, in one pass over the list.
 *
 * The counts come from the same `totalsOf` the browser's own usage figures are built on — this
 * package carries that module as a byte-for-byte copy — so the two cannot drift into disagreeing
 * about what "in the trash" means. Being in the trash is INHERITED: a file under a trashed folder
 * is trashed even though nothing marked the file itself, and a count that read only the file's own
 * mark would report bytes as live that the server has already stopped serving.
 */
export function computeUsage(index: ManifestIndex): UsageReport {
  const totals = totalsOf(index);
  const biggest = index.all
    .filter((entry) => entry.kind === KIND_FILE && isLive(index, entry))
    // Largest first, ties broken by name — so two runs over one unchanged list name the same
    // files in the same order instead of reshuffling whatever the list order happened to be.
    .slice()
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, BIGGEST_SHOWN)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: fullPathOf(index, entry),
      size: entry.size,
    }));
  return {
    files: totals.files,
    folders: totals.folders,
    bytes: totals.bytes,
    trashedFiles: totals.trashedFiles,
    trashedBytes: totals.trashedBytes,
    biggest,
  };
}
