// `nmts ls` — what is in the account, read from the sealed file list.
//
// ⚠ IT ANSWERS FROM THE LIST, NOT FROM THE FILES. Names, sizes and folders live in one sealed
//   blob that only this account's key opens; the server holds it and cannot read it. So this
//   command proves what the list says, and proves nothing about whether the bytes behind each
//   entry are still fetchable — that is what `get` will be for.
//
// ⛔ TRASHED ENTRIES ARE HIDDEN BY DEFAULT AND SAID TO BE HIDDEN. A count that silently omits
//    things is how somebody concludes a file is gone. `--all` shows them, marked.
//
// ⛔ AND THAT RULE GOVERNS THE TWO NEW WAYS OF SHOWING LESS. `--find` prints a subset and says how
//    many files it left out and that folders holding no match are gone from the table; `--sort`
//    changes the order and never the membership. A narrowed listing that looks exactly like a full
//    one is the same defect as a silent trash filter, arrived at from a different direction.
//
// ⛔ A WRONG OPTION IS REFUSED BEFORE THE ACCOUNT IS TOUCHED. `--sort largest` is a wrong command
//    line, not a failing account, so it costs no round trip and reads as exit 2 — otherwise an
//    agent that mistyped a key goes off investigating the account instead of its own arguments.

import { CODE_ENV_VAR } from "../credentials.ts";
import { buildIndex, fullPathOf, isLive, KIND_FOLDER, trashedAt } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { marksOf, markSuffix, type EntryMarks } from "../mark-render.ts";
import { idsForQuery, needleOf } from "../list-view-find.ts";
import { orderRows, parseSortKey, type SortDir, type SortKey } from "../list-view-order.ts";
import { readFileList } from "../manifest.ts";
import { openSession } from "../session.ts";
import { daysLeftInTrash, TRASH_RETENTION_DAYS } from "../trash-sweep.ts";
import { humanSize } from "../units.ts";

export interface LsOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Machine-readable output. For an agent this is the shape to parse; the table is for a person. */
  json?: boolean;
  /** Include entries that are in the trash. */
  all?: boolean;
  /**
   * Keep only files whose name contains this text, case-insensitively.
   *
   * Taken as plain text rather than a parsed key so this command owns the refusal for a query that
   * cannot mean anything — see `list-view-find.ts` for what a query does and does not match.
   */
  find?: string | undefined;
  /** `name`, `size` or `date`. Absent = the path order this command has always printed. */
  sort?: string | undefined;
  /** Reverse whichever order is in effect. */
  desc?: boolean;
  write?: (line: string) => void;
  /** The instant the trash countdown is measured against. Passed in so one listing means one moment. */
  now?: number;
}

/** One row of the table, before it is printed either way. */
interface Row {
  id: string;
  path: string;
  name: string;
  kind: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  trashed: boolean;
  trashedAt: number | null;
  marks: EntryMarks;
  pinned?: boolean;
}

/**
 * How much of a trashed entry's thirty days is left, in the words beside its row.
 *
 * ⛔ A TRASHED ROW HAS TO SAY WHEN. "[trash]" on its own tells somebody the file is recoverable and
 *    not for how long, so the row that is about to lose its key looks exactly like the one thrown
 *    away this morning — and the entry, once dropped, takes with it this account's copy of the key
 *    that opens the file.
 */
function trashWindow(trashedAtMs: number, nowMs: number): string {
  const left = daysLeftInTrash(trashedAtMs, nowMs);
  if (left <= 0) return `past ${TRASH_RETENTION_DAYS} days — \`nmts sweep\` drops it`;
  return `${left} day${left === 1 ? "" : "s"} left`;
}

/**
 * The order this command has printed since it existed: whole paths, ascending.
 *
 * ⛔ IT IS STILL THE DEFAULT, and `--sort` is what asks for the browser's order instead. A path
 *    order is the only one that draws the tree — every file sits under the folder that holds it —
 *    and that is what somebody reading a flat listing of a whole drive is reading it for. Changing
 *    the default would also silently rewrite what every script that already parses this output
 *    sees.
 *
 * ⚠ `--desc` reverses it exactly, the same way it reverses the other three keys.
 */
function byPath(rows: readonly Row[], dir: SortDir): Row[] {
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path));
  return dir === "desc" ? sorted.reverse() : sorted;
}

export async function ls(options: LsOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now();
  const dir: SortDir = options.desc === true ? "desc" : "asc";
  const sort: SortKey | null = options.sort === undefined ? null : parseSortKey(options.sort);
  // ⛔ AN EMPTY QUERY IS REFUSED RATHER THAN IGNORED. `--find "$THING"` with nothing in `THING` is
  //    a script that lost its variable, and both quiet answers are wrong: listing everything hands
  //    back a drive that was never asked for, and listing nothing reports an empty account.
  const needle = options.find === undefined ? null : needleOf(options.find);
  if (needle === "") {
    throw new NmtsError(`--find was given nothing to look for.`, {
      exitCode: 2,
      nextStep: `Nothing was listed. Give it part of a file's name, as in \`--find report\`.`,
    });
  }
  // ⛔ THE REFUSALS ARE ONE TEXT, so they are resolved in one place. This command used to carry its
  //    own copy of the "no API key" wording — the sentence a new user is most likely to see — and
  //    it had already drifted from the other three (2026-08-23).
  const session = await openSession({ server: options.server, network: options.network });

  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);

  if (list.manifest === null) {
    if (options.json) {
      say(JSON.stringify({ state: "absent", entries: [] }));
      return 0;
    }
    say(`This account has no file list yet. Nothing has been uploaded from any device.`);
    return 0;
  }

  // ⛔ "IN THE TRASH" IS INHERITED. Trashing a folder marks the folder and nothing under it, so a
  //    filter on `e.deletedAt` alone leaves every file inside it listed as live — while the server,
  //    which was told to drop those rows, refuses their bytes. That is the one state this tool is
  //    built to avoid, and it shipped: `hiddenTrashed` said 1 while two unreachable files were
  //    printed as live (2026-08-23).
  const index = buildIndex(list.manifest.entries);
  const listed = options.all
    ? list.manifest.entries
    : list.manifest.entries.filter((e) => isLive(index, e));
  const hidden = list.manifest.entries.length - listed.length;

  // The query runs over what was going to be shown, so `--find` and `--all` compose instead of one
  // quietly widening the other: a search without `--all` searches the drive, not the trash.
  const keep = needle === null ? null : idsForQuery(index, listed, needle);
  const shown = keep === null ? listed : listed.filter((e) => keep.has(e.id));
  const filteredOutFiles =
    keep === null ? 0 : listed.filter((e) => e.kind !== KIND_FOLDER && !keep.has(e.id)).length;

  const mapped: Row[] = shown.map((e) => ({
    id: e.id,
    path: fullPathOf(index, e),
    name: e.name,
    kind: e.kind,
    size: e.size,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    trashed: !isLive(index, e),
    // ⚠ When the thirty days run out. Present only for the trash, and only where the tool can
    //   say it: an entry trashed by inheritance carries its ancestor's instant, not its own.
    trashedAt: trashedAt(index, e),
    marks: marksOf(e),
    ...(e.pinned === true ? { pinned: true } : {}),
  }));
  const rows = sort === null ? byPath(mapped, dir) : orderRows(mapped, sort, dir);

  if (options.json) {
    say(
      JSON.stringify({
        state: "present",
        seq: list.seq,
        serverSeqDisagreed: list.serverSeqDisagreed ?? null,
        firstTimeOnThisMachine: list.firstTimeOnThisMachine,
        hiddenTrashed: options.all ? 0 : hidden,
        // What `--find` was given and how many files it dropped, so a caller can tell a narrowed
        // listing from a whole one instead of comparing counts against a drive it cannot see.
        query: options.find ?? null,
        hiddenByQuery: filteredOutFiles,
        entries: rows.map((row) => ({
          id: row.id,
          path: row.path,
          name: row.name,
          kind: row.kind === KIND_FOLDER ? "folder" : "file",
          size: row.size,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          trashed: row.trashed,
          trashedAt: row.trashedAt,
          marks: row.marks,
        })),
      }),
    );
    return 0;
  }

  if (rows.length === 0) {
    if (needle === null) {
      say(`The file list is empty${hidden > 0 ? ` (${hidden} in the trash, hidden)` : ""}.`);
    } else {
      say(
        `No file in this account has "${options.find}" in its name` +
          (hidden > 0 ? ` (${hidden} in the trash, not searched — \`--all\` searches those too)` : ``) +
          `.`,
      );
    }
  } else {
    const width = Math.max(...rows.map((r) => r.path.length));
    for (const row of rows) {
      const size = row.kind === KIND_FOLDER ? "" : humanSize(row.size);
      const mark = row.trashed
        ? `  [trash${row.trashedAt === null ? "" : `, ${trashWindow(row.trashedAt, now)}`}]`
        : "";
      say(`${row.path.padEnd(width)}  ${size.padStart(9)}${mark}${markSuffix(row.marks)}`);
    }
    say(``);
    const files = rows.filter((r) => r.kind !== KIND_FOLDER).length;
    const total = rows.filter((r) => r.kind !== KIND_FOLDER).reduce((n, r) => n + r.size, 0);
    say(`${files} file${files === 1 ? "" : "s"} · ${humanSize(total)}` +
      (needle === null ? `` : ` matching "${options.find}"`) +
      (hidden > 0
        ? needle === null
          ? ` · ${hidden} in the trash, hidden (--all shows them)`
          : ` · ${hidden} in the trash, not searched (--all searches those too)`
        : ``));
    // ⛔ THE TABLE SAYS WHAT IT LEFT OUT. Under a query the rows above are not the drive, and the
    //    two ways that misleads are both quiet ones: files that did not match are simply absent,
    //    and so is every folder holding none of them — including a folder whose own name contains
    //    the text, because the query is matched against file names only.
    if (needle !== null) {
      say(``);
      if (filteredOutFiles > 0) {
        // Counted against what this same listing would have shown WITHOUT the query, so the
        // sentence stays true under `--all` as well: it never claims to have counted the trash.
        say(
          `  Without --find this listing would also have shown ${filteredOutFiles} other ` +
            `file${filteredOutFiles === 1 ? "" : "s"}, which did not match.`,
        );
      }
      say(`  Only file names are matched, so a folder is never a match of its own — the folders`);
      say(`  above are the ones that hold a match, and folders holding none are not listed.`);
    }
  }

  // ⛔ Said out loud rather than left as a footnote: on a first run there was nothing on this
  //    machine to compare the version against, so a rolled-back list would have looked normal.
  if (list.firstTimeOnThisMachine) {
    say(``);
    say(`  First listing on this machine, so nothing here could have caught an older list being`);
    say(`  served in place of the current one. From now on this tool refuses a version lower than`);
    say(`  the highest it has seen for this account.`);
  }
  if (list.serverSeqDisagreed !== undefined) {
    say(``);
    say(`  The server said version ${list.serverSeqDisagreed}; the sealed list says ${list.seq}.`);
    say(`  The sealed number is the one that is authenticated, so it is the one used.`);
  }
  return 0;
}
