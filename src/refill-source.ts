// Taking a file that credits paid for and handing it back as something a wallet can pay for:
// finding it in the sealed list, and getting its plaintext onto this machine once.
//
// ⛔ WHY IT IS A DOWNLOAD AND A RE-SEAL RATHER THAN A MOVE. Storage on the network is bought for
//    particular bytes under a particular blob id, and the treasury owns the storage under a
//    credit-paid part. Nothing on the chain can transfer that object to somebody's own wallet, and
//    nothing in NMTS can re-point an existing part at storage bought elsewhere. So the only honest
//    shape is: read the file out, seal it again, buy storage for the new sealing, and let the old
//    file go to the trash — which is what `put --pay wallet --from <path>` does.
//
// ⛔ THE PLAINTEXT LANDS IN THIS TOOL'S OWN DIRECTORY, NOT IN THE SYSTEM TEMPORARY ONE. It is
//    somebody's decrypted file; `/tmp` is world-listable on every machine this runs on, and a name
//    other accounts can see is a name they can watch for. The config directory is 0700 where the
//    platform honours it, the file itself is 0600 (`fileSink`), and it is removed on every path out
//    including the failing ones.
//
// ⚠ IT IS A COPY ON DISK FOR AS LONG AS THE UPLOAD TAKES, and that is the price of not holding a
//   whole file in memory. A caller who cannot pay it should download and upload by hand, which is
//   the same two acts with the copy in a place they chose.

import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { configDir } from "./credentials.ts";
import { setTrashed } from "./item-trash.ts";
import { applyManyToList, type ListEditInput } from "./manifest-write.ts";
import type { ManifestIntent } from "./shared/lib/drive/manifest-ops.ts";
import { fetchFile } from "./download.ts";
import { fileSink } from "./download-sink-node.ts";
import { buildIndex, entryAt, fullPathOf, isLive, KIND_FILE, normalisePath } from "./drive-paths.ts";
import { NmtsError } from "./errors.ts";
import type { Network } from "./network.ts";
import { BINARY_NAME } from "./product.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";

/** The file a re-upload is built from, and exactly where the new one goes. */
export interface DriveOriginal {
  /** The entry as the list holds it — the id that goes to the trash, and the key that opens it. */
  entry: ManifestEntry;
  /** The name the new file takes: the old one's, because this replaces it in place. */
  name: string;
  parentId: string | null;
  /**
   * The folder the new file goes in, spelled as a path.
   *
   * ⚠ IT IS PART OF THE RESERVATION KEY, so it has to be the same string on a second attempt at
   *   the same re-upload. Built from the list rather than from what somebody typed, which is what
   *   makes it stable: `--from ./docs/a.txt` and `--from docs/a.txt` are one file and one key.
   */
  destination: string;
}

/**
 * The live file a drive path names, with the place the replacement goes.
 *
 * ⛔ A FOLDER, A TRASHED FILE AND A FILE WITH NO KEY ARE ALL REFUSED HERE, before anything is
 *    priced. Each one would fail later, after a price had been quoted and possibly after money had
 *    moved, and the third would fail in the worst place of all: the download.
 */
export function findOriginal(entries: readonly ManifestEntry[], path: string): DriveOriginal {
  const wanted = normalisePath(path);
  const index = buildIndex(entries);
  const entry = entryAt(entries, wanted, { nothingHappened: "Nothing was signed and nothing was sent." });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`"${wanted}" is a folder.`, {
      exitCode: 4,
      nextStep: `Nothing was signed. --from takes one file at a time.`,
    });
  }
  if (!isLive(index, entry)) {
    throw new NmtsError(`"${wanted}" is in the trash.`, {
      exitCode: 4,
      nextStep: `Nothing was signed. \`${BINARY_NAME} restore\` brings it back, and then this can re-upload it.`,
    });
  }
  if (entry.dekWrapped === undefined) {
    throw new NmtsError(`The file list holds no key for "${wanted}".`, {
      exitCode: 4,
      nextStep: `Nothing was signed. Without it nothing can open the stored bytes, so there is nothing to re-seal.`,
    });
  }
  const full = fullPathOf(index, entry);
  return {
    entry,
    name: entry.name,
    parentId: entry.parentId,
    destination: full.slice(0, Math.max(0, full.length - entry.name.length)).replace(/\/$/, ""),
  };
}

/** Where a downloaded plaintext waits while it is being sealed again. */
export interface Scratch {
  localPath: string;
  /** Remove it. Safe to call twice, and called on every path out. */
  remove: () => void;
}

/**
 * Read one file out of the account and leave it on this machine, checked.
 *
 * ⛔ THE SAME READ `nmts get` MAKES, including the whole-file hash. A re-upload that sealed bytes
 *    the download had not proved would replace a good file with a corrupt one and put the good one
 *    in the trash — the one outcome this command must never produce.
 */
export async function downloadForRefill(input: {
  server: string;
  apiKey: string;
  code: string;
  network: Network;
  original: DriveOriginal;
}): Promise<Scratch> {
  const { entry } = input.original;
  const dekWrapped = entry.dekWrapped;
  if (dekWrapped === undefined) throw new NmtsError("unreachable: an original with no key");
  const area = join(configDir(), "refill");
  mkdirSync(area, { recursive: true, mode: 0o700 });
  const localPath = join(area, `${randomBytes(9).toString("hex")}.part`);
  const remove = (): void => rmSync(localPath, { force: true });
  try {
    await fetchFile({
      base: input.server,
      apiKey: input.apiKey,
      accountCode: input.code,
      itemId: entry.id,
      size: entry.size,
      dekWrapped,
      ...(entry.contentHashCt === undefined ? {} : { contentHashCt: entry.contentHashCt }),
      chain: input.network,
      sink: fileSink(localPath, { force: true }),
    });
  } catch (error) {
    remove();
    throw error;
  }
  return { localPath, remove };
}

/**
 * Give the new file the old one's name and put the old one in the trash — after the upload, in one
 * write.
 *
 * ⛔ WHY IT IS A SECOND WRITE AND NOT AN OVERWRITE ON THE COMMIT. `collision.ts` refuses to let a
 *    per-run answer of "overwrite" take effect while this machine is in the default mode, on
 *    purpose: a program passing a flag must not be able to destroy a file. That rule is not worked
 *    around here. The upload lands as an ordinary addition — numbered beside the original if the
 *    machine renames — and only then, with the paid-for bytes safely in the list, is the name moved
 *    across and the original trashed. A person named the file they were replacing; nothing here
 *    decides that for anybody.
 *
 * ⛔ AND THE ORDER IS THE ONE THE WHOLE TOOL KEEPS: the new file is committed first, so a failure
 *    anywhere in this step leaves both files in the drive rather than neither. Running the same
 *    command again is not the repair for that — the file is already there under a numbered name —
 *    so what a failure here costs is a rename somebody does by hand, never bytes.
 *
 * ⚠ IT IS DECIDED AGAIN ON EVERY ATTEMPT of the compare-and-swap, which is what makes it safe to
 *   replay: a list where another device already trashed the original, or where this run's own
 *   earlier attempt already renamed the new file, produces no intent for that half.
 */
export async function settleRefill(
  input: ListEditInput,
  original: DriveOriginal,
  newItemId: string,
): Promise<number> {
  const at = Date.now();
  const result = await applyManyToList(input, (entries) => {
    const intents: ManifestIntent[] = [];
    const old = entries.find((e) => e.id === original.entry.id);
    if (old !== undefined && old.deletedAt === undefined) {
      intents.push({ op: "trash", ids: [original.entry.id], at });
    }
    const fresh = entries.find((e) => e.id === newItemId);
    if (fresh !== undefined && fresh.name !== original.name) {
      intents.push({ op: "rename", id: newItemId, name: original.name, at });
    }
    return intents;
  });
  // ⛔ THE SERVER IS TOLD LAST, and a 404 there is "already in that state" (`item-trash.ts`). Until
  //    this line the original is a live row the account still holds — which is the harmless
  //    direction: it is restorable, it still expires on its own, and `nmts rm` finishes the job.
  await setTrashed(input.server, input.apiKey, original.entry.id, true);
  return result.seq;
}
