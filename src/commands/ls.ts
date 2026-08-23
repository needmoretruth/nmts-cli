// `nmts ls` — what is in the account, read from the sealed file list.
//
// ⚠ IT ANSWERS FROM THE LIST, NOT FROM THE FILES. Names, sizes and folders live in one sealed
//   blob that only this account's key opens; the server holds it and cannot read it. So this
//   command proves what the list says, and proves nothing about whether the bytes behind each
//   entry are still fetchable — that is what `get` will be for.
//
// ⛔ TRASHED ENTRIES ARE HIDDEN BY DEFAULT AND SAID TO BE HIDDEN. A count that silently omits
//   things is how somebody concludes a file is gone. `--all` shows them, marked.

import { identityOf } from "../account.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, readCredentialsFile, resolveApiKey, resolveAccountCode } from "../credentials.ts";
import { NmtsError, NotLoggedInError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";

export interface LsOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Machine-readable output. For an agent this is the shape to parse; the table is for a person. */
  json?: boolean;
  /** Include entries that are in the trash. */
  all?: boolean;
  write?: (line: string) => void;
}

/** Bytes as a person reads them. Decimal units, because that is what storage is sold in. */
function humanSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Full path of an entry, from the drive root. Cycles cannot loop forever. */
function pathOf(entry: ManifestEntry, byId: Map<string, ManifestEntry>): string {
  const parts = [entry.name];
  const seen = new Set<string>([entry.id]);
  let parent = entry.parentId;
  while (parent !== null) {
    const node = byId.get(parent);
    // A parent that is not in the list, or a cycle, is a damaged list — not a reason to hang.
    if (node === undefined || seen.has(node.id)) {
      parts.unshift("…");
      break;
    }
    seen.add(node.id);
    parts.unshift(node.name);
    parent = node.parentId;
  }
  return parts.join("/");
}

export async function ls(options: LsOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const resolved = resolveAccountCode();
  if (resolved === null) throw new NotLoggedInError(BINARY_NAME, CODE_ENV_VAR);

  const key = resolveApiKey();
  if (key === null) {
    throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
      exitCode: 3,
      nextStep:
        `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
        `it with \`${BINARY_NAME} login\`. The key is what lets a program act without passing the ` +
        `human check that a browser sign-in does.`,
    });
  }

  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  resolveNetwork(server, options.network ?? stored?.network);
  const identity = await identityOf(resolved.code);

  const list = await readFileList(server, key.key, resolved.code, identity.accountId);

  if (list.manifest === null) {
    if (options.json) {
      say(JSON.stringify({ state: "absent", entries: [] }));
      return 0;
    }
    say(`This account has no file list yet. Nothing has been uploaded from any device.`);
    return 0;
  }

  const byId = new Map(list.manifest.entries.map((e) => [e.id, e]));
  const shown = options.all
    ? list.manifest.entries
    : list.manifest.entries.filter((e) => e.deletedAt === undefined);
  const hidden = list.manifest.entries.length - shown.length;
  const rows = shown
    .map((e) => ({
      id: e.id,
      path: pathOf(e, byId),
      kind: e.kind === 0 ? ("folder" as const) : ("file" as const),
      size: e.size,
      updatedAt: e.updatedAt,
      trashed: e.deletedAt !== undefined,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (options.json) {
    say(
      JSON.stringify({
        state: "present",
        seq: list.seq,
        serverSeqDisagreed: list.serverSeqDisagreed ?? null,
        firstTimeOnThisMachine: list.firstTimeOnThisMachine,
        hiddenTrashed: options.all ? 0 : hidden,
        entries: rows,
      }),
    );
    return 0;
  }

  if (rows.length === 0) {
    say(`The file list is empty${hidden > 0 ? ` (${hidden} in the trash, hidden)` : ""}.`);
  } else {
    const width = Math.max(...rows.map((r) => r.path.length));
    for (const row of rows) {
      const size = row.kind === "folder" ? "" : humanSize(row.size);
      const mark = row.trashed ? "  [trash]" : "";
      say(`${row.path.padEnd(width)}  ${size.padStart(9)}${mark}`);
    }
    say(``);
    const files = rows.filter((r) => r.kind === "file").length;
    const total = rows.filter((r) => r.kind === "file").reduce((n, r) => n + r.size, 0);
    say(`${files} file${files === 1 ? "" : "s"} · ${humanSize(total)}` +
      (hidden > 0 ? ` · ${hidden} in the trash, hidden (--all shows them)` : ""));
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
