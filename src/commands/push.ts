// `nmts push <directory>` — a whole directory, with its shape, paid for with credits.
//
// ⛔ IT STOPS AT THE FIRST FAILURE, and that is the opposite of what `pull` does. Pulling costs
//    nothing, so carrying on past one bad file saves the nineteen good ones. Pushing SPENDS: a
//    failure that is really "this account cannot pay any more" would, if carried past, keep asking
//    to pay for every remaining file. So the run stops, says what is already uploaded — those
//    files are real and paid for — and says that running it again does the rest.
//
// ⛔ AND IT SKIPS WHAT IS ALREADY THERE, which is what makes running it again safe. Without that,
//    a second run would upload every file a second time and the drive would fill with numbered
//    copies: this tool never replaces a file, so the second `notes.txt` becomes `notes (2).txt`
//    and the account pays for both.
//
// ⛔ NOTHING HIDDEN IS SENT. Entries whose name begins with a dot are left alone unless they are
//    asked for: a directory of source code carries credentials in exactly those files, and an
//    upload goes to a public storage network. `--hidden` includes them.

import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { requireConsent } from "../consent.ts";
import { DERIVED, loadCrypto } from "../crypto.ts";
import { normaliseName, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { addEntry } from "../manifest-write.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { Progress, silentSink, stderrSink } from "../progress.ts";
import { openSession } from "../session.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { fileSource, partKeysOf, uploadFile } from "../upload-file.ts";
import { createUploadApi } from "../upload-api.ts";
import { clearItemRecord, clearReservation } from "../upload-store.ts";
import { CREDIT_BYTES, partSizeFor, planAndPrice, UPLOAD_EPOCHS } from "../upload-price.ts";
import { createBlobProtocol, readCurrentEpoch } from "../walrus-write.ts";
import { ensureFolderPath } from "./organise.ts";

export interface PushOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Where the tree goes in the drive. The top of the drive when absent. */
  to?: string | undefined;
  /** Say what it would cost and stop. Nothing is sealed, sent, or charged. */
  dryRun?: boolean;
  /** Include entries whose name begins with a dot. */
  hidden?: boolean;
  partSize?: string | number | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /**
   * Send ONE file. The real one seals, buys, uploads and records it.
   *
   * ⛔ A SEAM, NOT A CONVENIENCE. What is worth testing here is the decisions AROUND the upload —
   *    which files are skipped, what is priced, and what a run says after it stops half way — and
   *    every one of those needs a failure that costs no money to produce.
   */
  send?: (one: PlannedFile, parentId: string | null) => Promise<string>;
}

/** One local file, and where it goes in the drive. */
export interface PlannedFile {
  /** Absolute path on this machine. */
  local: string;
  /** Folder path inside the drive. */
  folder: string;
  name: string;
  size: number;
}

export async function push(target: string | undefined, options: PushOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (target === undefined || target === "") {
    throw new NmtsError("Say which directory to push.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} push <directory>\` — a directory on this machine.`,
    });
  }
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

  const under = normalisePath(options.to ?? "");
  const base = under === "" ? basename(root) : `${under}/${basename(root)}`;
  const found = walk(root, base, options.hidden === true);
  if (found.length === 0) {
    if (options.json) {
      say(JSON.stringify({ files: 0, uploaded: 0, skipped: 0, credits: 0 }));
      return 0;
    }
    say(`${root} holds no files to send.`);
    return 0;
  }

  const session = await openSession({ server: options.server, network: options.network });
  const partSize = partSizeFor(options.partSize);
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const rule: PaddingRule = list.manifest?.settings?.paddingMode === "pow2" ? "pow2" : "padme";

  // ⛔ WHAT IS ALREADY THERE IS DECIDED BEFORE ANYTHING IS PRICED, so the number printed is what
  //    this run will actually spend rather than what a first run would have.
  const entries = list.manifest?.entries ?? [];
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

  const credits = todo.reduce((sum, one) => sum + planAndPrice(one.size, partSize, rule).credits, 0);
  const bytes = todo.reduce((sum, one) => sum + one.size, 0);

  if (options.dryRun === true) {
    if (options.json) {
      say(
        JSON.stringify({
          files: found.length,
          toSend: todo.length,
          skipped: already.length,
          bytes,
          credits,
          epochs: UPLOAD_EPOCHS,
        }),
      );
      return 0;
    }
    say(`${todo.length} file${todo.length === 1 ? "" : "s"}  ${bytes} bytes  →  ${credits} credit${credits === 1 ? "" : "s"}`);
    if (already.length > 0) {
      say(`  ${already.length} already in the drive, which this would not send again`);
    }
    say(``);
    say(`  Nothing was sent and nothing was charged.`);
    return 0;
  }

  requireConsent("spend");

  const progress = new Progress(options.json === true ? silentSink() : stderrSink(), "uploading");
  const crypt = await loadCrypto();
  // ⛔ READ ONCE, AND ONLY IF SOMETHING IS ACTUALLY SENT. It is a chain read: a run whose files are
  //    all already in the drive should not need a storage network to be reachable to say so.
  let epoch: number | null | undefined;
  const currentEpoch = async (): Promise<number | null> => {
    if (epoch === undefined) epoch = await readCurrentEpoch(session.network);
    return epoch;
  };

  if (!options.json) {
    say(`${todo.length} file${todo.length === 1 ? "" : "s"}  →  ${credits} credit${credits === 1 ? "" : "s"}`);
    if (already.length > 0) say(`  ${already.length} already there, not sent again`);
  }

  const uploaded: string[] = [];
  try {
    for (const one of todo) {
      const parentId = await folderFor(session, folderIds, one.folder);
      if (!options.json) say(`  ${one.folder}/${one.name}`);
      const send =
        options.send ??
        (async (file: PlannedFile, into: string | null) =>
          sendOne(session, crypt, file, {
            parentId: into,
            partSize,
            rule,
            currentEpoch: await currentEpoch(),
            progress,
          }));
      uploaded.push(`${one.folder}/${await send(one, parentId)}`);
    }
  } catch (error) {
    progress.done();
    // ⛔ WHAT IS UPLOADED IS REAL AND PAID FOR. Saying so is the difference between somebody
    //    running this again — which sends only the rest — and somebody assuming it all failed.
    const because = error instanceof Error ? error.message : String(error);
    throw new NmtsError(because, {
      exitCode: 1,
      nextStep:
        uploaded.length === 0
          ? "Nothing was uploaded."
          : `${uploaded.length} file${uploaded.length === 1 ? " is" : "s are"} uploaded and paid ` +
            `for. Running the same command again sends only what is missing.`,
    });
  } finally {
    progress.done();
  }

  if (options.json) {
    say(JSON.stringify({ files: found.length, uploaded: uploaded.length, skipped: already.length, bytes, credits }));
    return 0;
  }
  say(``);
  say(`${uploaded.length} sent · ${already.length} already there`);
  return 0;
}

/** Seal, buy, upload and record ONE file. The account's data key does not outlive it. */
async function sendOne(
  session: Awaited<ReturnType<typeof openSession>>,
  crypt: Awaited<ReturnType<typeof loadCrypto>>,
  one: PlannedFile,
  ctx: {
    parentId: string | null;
    partSize: number;
    rule: PaddingRule;
    currentEpoch: number | null;
    progress: Progress;
  },
): Promise<string> {
  const derived = crypt.kdf_derive(crypt.account_code_parse(session.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  const protocol = createBlobProtocol(session.network, one.size, (sent, total) =>
    ctx.progress.update(sent, total),
  );
  try {
    const result = await uploadFile({
      api: createUploadApi(session.server, session.apiKey),
      protocol,
      crypt,
      dataKey,
      source: fileSource(one.local, one.size),
      name: one.name,
      parentId: ctx.parentId,
      destination: one.folder,
      relayUrl: protocol.relayUrl,
      epochs: UPLOAD_EPOCHS,
      currentEpoch: ctx.currentEpoch,
      partSize: ctx.partSize,
      padding: { rule: ctx.rule, unitBytes: CREDIT_BYTES },
    });
    const now = Date.now();
    // ⛔ FROM THE RESULT, NOT FROM THIS RUN. The key that opens the stored bytes is the key they
    //    were sealed with, which on a resume belongs to the run that sealed them.
    const added = await addEntry({
      server: session.server,
      apiKey: session.apiKey,
      code: session.code,
      accountId: session.accountId,
      entry: {
        id: result.itemId,
        parentId: ctx.parentId,
        kind: 1,
        name: result.entry.name,
        size: result.entry.plaintextLen,
        createdAt: now,
        updatedAt: now,
        dekWrapped: result.entry.dekWrapped,
        contentHashCt: result.entry.contentHashCt,
      },
    });
    // ⛔ ONLY NOW. Until the entry is in the list the file is paid for and invisible.
    clearItemRecord(result.fileKey);
    for (const record of partKeysOf(result.fileKey, result.parts)) clearReservation(record);
    return added.name;
  } finally {
    dataKey.fill(0);
  }
}

/** The folder id for a drive path, made if it is not there yet. Remembered for the next file. */
async function folderFor(
  session: Awaited<ReturnType<typeof openSession>>,
  known: Map<string, string | null>,
  folder: string,
): Promise<string | null> {
  const held = known.get(folder);
  if (held !== undefined) return held;
  const { parentId } = await ensureFolderPath(session, folder);
  known.set(folder, parentId);
  return parentId;
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
