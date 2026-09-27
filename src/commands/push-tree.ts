// The directory side of `nmts push`: what is on this machine, and what the drive already holds.
//
// ⚠ MOVED OUT OF `push.ts` UNCHANGED (2026-09-24) so both tiers read one tree the same way — that
//   file had reached the length gate the day NMTS Heavy needed the same walk and the same
//   "already there" rule. The rules are the ones `push.ts` states in its header: dot-files stay
//   unless asked for, symbolic links are not followed, and a name already in its folder is skipped.

import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { normaliseName, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME } from "../product.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";

/** One local file, and where it goes in the drive. */
export interface PlannedFile {
  /** Absolute path on this machine. */
  local: string;
  /** Folder path inside the drive. */
  folder: string;
  name: string;
  size: number;
}

/** The directory as typed: refused when it is missing or a file, then walked. */
export function localTree(target: string, to: string | undefined, hidden: boolean): { root: string; found: PlannedFile[] } {
  const root = resolve(target);
  let rootStat: ReturnType<typeof statSync>;
  try {
    rootStat = statSync(root);
  } catch {
    throw new NmtsError(`There is nothing at ${root}.`, { exitCode: 4 });
  }
  if (!rootStat.isDirectory()) {
    throw new NmtsError(`${root} is a file.`, {
      exitCode: 4,
      nextStep: `Nothing was sent. \`${BINARY_NAME} put\` uploads one file.`,
    });
  }
  const under = normalisePath(to ?? "");
  const base = under === "" ? basename(root) : `${under}/${basename(root)}`;
  return { root, found: walk(root, base, hidden) };
}

/** Which found files the drive already holds, which to send, and the folders already known. */
export function splitAlready(
  entries: readonly ManifestEntry[],
  found: readonly PlannedFile[],
): { folderIds: Map<string, string | null>; already: PlannedFile[]; todo: PlannedFile[] } {
  const taken = new Set(
    entries
      .filter((e) => e.deletedAt === undefined)
      .map((e) => `${e.parentId ?? ""} ${normaliseName(e.name)}`),
  );
  const folderIds = new Map<string, string | null>();
  const already: PlannedFile[] = [];
  const todo: PlannedFile[] = [];
  for (const one of found) {
    const parentId = knownFolderId(entries, one.folder);
    if (parentId !== undefined) folderIds.set(one.folder, parentId);
    const there = parentId !== undefined && taken.has(`${parentId ?? ""} ${normaliseName(one.name)}`);
    (there ? already : todo).push(one);
  }
  return { folderIds, already, todo };
}


export { walk as filesUnderDirectory };

/** Every file under a local directory, with the drive folder each one belongs in. */
function walk(dir: string, driveFolder: string, hidden: boolean): PlannedFile[] {
  const out: PlannedFile[] = [];
  const items = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    if (!hidden && item.name.startsWith(".")) continue;
    const local = join(dir, item.name);
    // ⛔ SYMBOLIC LINKS ARE NOT FOLLOWED. One pointing at a parent directory would walk forever,
    //    and one pointing outside would upload a file nobody meant to send.
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      out.push(...walk(local, `${driveFolder}/${item.name}`, hidden));
      continue;
    }
    if (!item.isFile()) continue;
    const size = statSync(local).size;
    // An empty file has nothing to store, and the storage network would refuse the reservation.
    if (size === 0) continue;
    out.push({ local, folder: driveFolder, name: item.name, size });
  }
  return out;
}

/** The id of a drive folder path that ALREADY exists, or undefined when it does not. */
function knownFolderId(
  entries: readonly ManifestEntry[],
  folder: string,
): string | null | undefined {
  if (folder === "") return null;
  let parentId: string | null = null;
  for (const name of folder.split("/")) {
    const there: ManifestEntry | undefined = entries.find(
      (e) =>
        e.parentId === parentId &&
        e.kind === 0 &&
        e.deletedAt === undefined &&
        normaliseName(e.name) === normaliseName(name),
    );
    if (there === undefined) return undefined;
    parentId = there.id;
  }
  return parentId;
}
