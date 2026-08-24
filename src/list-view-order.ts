// The order a listing comes out in — the browser drive's rule, written out again here.
//
// ⛔ IT IS A TRANSCRIPTION, AND THAT IS THE WHOLE POINT. One account is read in a browser and from
//    this tool, often minutes apart. If `--sort size` here and the size order there disagreed
//    about two files of equal size, or about where folders sit, somebody comparing the two screens
//    has no way to tell which of them is lying about their own drive — both are complete, exact
//    listings of the same sealed list. So the rules below are the ones the NMTS web drive sorts
//    by, transcribed in full.
//
// ⛔ TRANSCRIBED RATHER THAN IMPORTED. Nothing in this package reads the browser tree: that tree
//    is React-bound and built by a different toolchain, and this tool has to keep running when it
//    is packaged on its own. What holds the two together is that the rule is small enough to write
//    down completely — which is what the block below does.
//
// WHAT THE RULE IS, IN FULL:
//   1. Names compare with the machine's own locale and NUMERIC collation, so `photo 2` comes
//      before `photo 10`. Plain text order puts 10 first, which reads as a defect to anybody who
//      has ever numbered files.
//   2. A tie on size or date falls back to the name, so two runs over one unchanged list print the
//      same order rather than wobbling.
//   3. Descending is the EXACT REVERSE of ascending — the tie-break included, and not the
//      comparator with its sign flipped. Flipping the sign would leave the name tie-break running
//      upwards inside a downwards list, so reversing the sort would leave the tied rows sitting in
//      the order they were already in.
//   4. Folders are their own group, above the files, whichever way the sort runs. The browser
//      draws them as a separate section above the file list; a flat listing has no sections, so
//      the group order is what carries that promise across.
//   5. Rows carrying the pinned mark are lifted to the top of their group afterwards, keeping the
//      order the sort gave them. That is the only thing pinning is for, and it has to hold under
//      every key and both directions or it means nothing.
//
// ⚠ A FOLDER HAS NO SIZE OF ITS OWN — the sealed list stores 0 — so sorting folders by size sorts
//   them by name. That is the honest outcome rather than a gap: a folder's weight is known only by
//   walking it, and inventing one to sort by would be a fabricated number in a column of measured
//   ones.
//
// ⚠ ONE DIFFERENCE THAT IS NOT A DIFFERENCE. The browser compares an RFC3339 string; the sealed
//   list holds milliseconds and this compares those. They order the same instants — the string
//   form is zero-padded and in UTC, so text order is chronological order — and they tie on the
//   same rows, because equal milliseconds render as one equal string.

import { KIND_FOLDER } from "./drive-paths.ts";
import { NmtsError } from "./errors.ts";

export type SortKey = "name" | "size" | "date";
export type SortDir = "asc" | "desc";

/** What `--sort` accepts, in the order the help text names them. */
export const SORT_KEYS: readonly SortKey[] = ["name", "size", "date"];

/** The fields ordering reads. Everything else about a row is the listing's business. */
export interface OrderableRow {
  name: string;
  /** Plaintext bytes. Folders carry 0. */
  size: number;
  /** Created, milliseconds since the Unix epoch. */
  createdAt: number;
  /** 0 folder · 1 file — the codes the sealed list stores. */
  kind: number;
  /** Held at the top of its group under every sort. Absent on rows that carry no mark. */
  pinned?: boolean;
}

/**
 * One of the three keys, or the refusal that names all three.
 *
 * ⛔ IT IS CHECKED BEFORE ANYTHING IS FETCHED. A misspelled key is a wrong command line, not a
 *    failing account, and an agent that read "could not list your files" after typing `--sort
 *    largest` would go looking at the account. Exit 2 says the same thing every other bad option
 *    in this tool says.
 */
export function parseSortKey(input: string): SortKey {
  // Compared rather than asserted: the compiler checks that every key in the list is a SortKey,
  // which a cast from `string` would not.
  for (const key of SORT_KEYS) if (key === input) return key;
  throw new NmtsError(`"${input}" is not something this can sort by.`, {
    exitCode: 2,
    nextStep: `Nothing was listed. Sort by one of: ${SORT_KEYS.join(", ")}.`,
  });
}

function byName(a: OrderableRow, b: OrderableRow): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

function comparatorFor(sort: SortKey): (a: OrderableRow, b: OrderableRow) => number {
  if (sort === "size") return (a, b) => a.size - b.size || byName(a, b);
  if (sort === "date") return (a, b) => a.createdAt - b.createdAt || byName(a, b);
  return byName;
}

/** One group — folders, or files — ordered, reversed if asked, then the pinned rows lifted. */
function orderGroup<T extends OrderableRow>(rows: readonly T[], sort: SortKey, dir: SortDir): T[] {
  const sorted = [...rows].sort(comparatorFor(sort));
  const ordered = dir === "desc" ? sorted.reverse() : sorted;
  if (!ordered.some((row) => row.pinned === true)) return ordered;
  return [
    ...ordered.filter((row) => row.pinned === true),
    ...ordered.filter((row) => row.pinned !== true),
  ];
}

/**
 * Rows in the browser's order: folders first, then files, each group by the chosen key.
 *
 * The input array is left alone — a caller printing one order and counting over another would
 * otherwise depend on which of the two ran first.
 */
export function orderRows<T extends OrderableRow>(
  rows: readonly T[],
  sort: SortKey,
  dir: SortDir,
): T[] {
  return [
    ...orderGroup(rows.filter((row) => row.kind === KIND_FOLDER), sort, dir),
    ...orderGroup(rows.filter((row) => row.kind !== KIND_FOLDER), sort, dir),
  ];
}
