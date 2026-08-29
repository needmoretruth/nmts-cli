// `nmts put <file>` — one file in, sealed on this machine, paid for with credits.
//
// ⛔ THE ONLY COMMAND IN THIS TOOL THAT SPENDS. Everything about it is arranged so that is never a
//   surprise: `--dry-run` says the price without paying it, the price is printed before the work
//   starts, and a failure says whether the money already moved. The machinery that keeps a half
//   finished upload from becoming money that bought nothing is in `upload.ts`.
//
// ⛔ THE PLAINTEXT NEVER LEAVES THIS PROCESS. What goes to the storage network is the sealed
//   stream; what goes to the server is its length, and a name that is itself inside the account's
//   sealed file list. Nothing in this file sends a file name anywhere but into that list.

import { basename, resolve } from "node:path";

import { identityOf } from "../account.ts";
import { requireAccountCode } from "../code-access.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, readCredentialsFile, resolveApiKey } from "../credentials.ts";
import { parseAsked } from "../collision.ts";
import { requireConsent } from "../consent.ts";
import { DERIVED, loadCrypto } from "../crypto.ts";
import { buildIndex, fullPathOf, isLive, KIND_FOLDER, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { Progress, silentSink, stderrSink } from "../progress.ts";
import { setTrashed } from "../item-trash.ts";
import { addEntry } from "../manifest-write.ts";
import { readFileList } from "../manifest.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import { resolveServer } from "../server.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { clearItemRecord, clearReservation } from "../upload-store.ts";
import { createUploadApi } from "../upload-api.ts";
import { fileSource, partKeysOf, uploadFile, type FileUploadStep } from "../upload-file.ts";
import {
  CREDIT_BYTES,
  creditsFor,
  measureLocal,
  partSizeFor,
  planAndPrice,
  UPLOAD_EPOCHS,
} from "../upload-price.ts";
import { createBlobProtocol, readCurrentEpoch } from "../walrus-write.ts";

export interface PutOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** The name it gets in the drive. Defaults to the local file's own name. */
  name?: string | undefined;
  /** Destination folder, as `nmts ls` prints it. The drive root when absent. */
  to?: string | undefined;
  /** Say what it would cost and stop. Nothing is sealed, sent, or charged. */
  dryRun?: boolean;
  /**
   * How much of the file goes into one part, in bytes. Defaults to `DEFAULT_PART_BYTES`.
   *
   * Bigger parts mean fewer reservations, and every reservation counts against the account's
   * daily spending allowance; smaller parts mean less memory and a shorter piece of work to lose
   * when something goes wrong. An exact number, not a menu — a person who knows what their machine
   * can hold should be able to say so.
   */
  partSize?: string | number | undefined;
  /** What THIS run does about a name already in use. Absent = this machine's setting. */
  onCollision?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

/**
 * The folder id `--to` names, or null for the root. Refuses rather than guessing.
 *
 * ⛔ IT IS THE SAME LOOKUP EVERY OTHER COMMAND USES. This had its own walk and its own
 *    `e.deletedAt` test, which meant it would happily accept a folder whose PARENT was in the
 *    trash and put a paid-for upload somewhere the drive does not show (2026-08-23).
 */
export function folderIdFor(
  wanted: string | undefined,
  entries: readonly ManifestEntry[],
): string | null {
  if (wanted === undefined) return null;
  const target = normalisePath(wanted);
  if (target === "") return null;
  const index = buildIndex(entries);
  const matches = entries.filter(
    (e) => e.kind === KIND_FOLDER && isLive(index, e) && normalisePath(fullPathOf(index, e)) === target,
  );
  const folder = matches[0];
  if (folder === undefined) {
    throw new NmtsError(`No folder at "${target}".`, {
      exitCode: 4,
      nextStep:
        `Nothing was sent and nothing was charged. Make it first with ` +
        `\`${BINARY_NAME} mkdir "${target}"\`, or leave --to off to put the file at the top of the drive.`,
    });
  }
  if (matches.length > 1) {
    throw new NmtsError(`"${target}" names ${matches.length} folders in this account.`, {
      exitCode: 4,
      nextStep: `Nothing was sent. Rename one of them with \`${BINARY_NAME} rename\`, then try again.`,
    });
  }
  return folder.id;
}


export async function put(target: string | undefined, options: PutOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (target === undefined || target === "") {
    throw new NmtsError("Say which file to put.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} put <file>\` — a path on this machine.`,
    });
  }
  const resolved = await requireAccountCode();
  const key = resolveApiKey();
  if (key === null) {
    throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
      exitCode: 3,
      nextStep:
        `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
        `it with \`${BINARY_NAME} login\`.`,
    });
  }

  const localPath = resolve(target);
  const size = measureLocal(localPath);
  const partSize = partSizeFor(options.partSize);
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);
  const identity = await identityOf(resolved.code);

  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(resolved.code));
  const dataKey = derived.slice(from, to);
  derived.fill(0);

  const name = options.name ?? basename(localPath);
  // The destination AS TYPED, so the reservation key can be worked out before any network call.
  const destination = (options.to ?? "").replace(/^\.?\//, "").replace(/\/$/, "");

  // ⛔ THE ACCOUNT'S OWN LIST IS READ BEFORE THE PRICE IS QUOTED, and that is why `--dry-run` needs
  //    the network. The rounding rule that hides a file's true size lives in the sealed list, it
  //    changes how many bytes are stored, and therefore it changes the price. A quote worked out
  //    without it would be right for one account and wrong for the other, which is worse than
  //    being slower.
  // ⛔ READ BEFORE ANYTHING IS SEALED OR PAID FOR. A misspelt answer that surfaced after the upload
  //    would have cost real money to produce a message about a typo.
  const asked = parseAsked(options.onCollision);
  const list = await readFileList(server, key.key, resolved.code, identity.accountId);
  const rule: PaddingRule = list.manifest?.settings?.paddingMode === "pow2" ? "pow2" : "padme";

  // ⛔ THE PRICE IS ARITHMETIC, NOT A MEASUREMENT: quoting it by sealing would mean reading and
  //    encrypting a very large file to answer `--dry-run`. Every part rounds up to a whole credit
  //    on its own, exactly as the server charges each reservation, so a file in several parts is
  //    quoted the way it will actually be billed.
  //
  // ⚠ ONLY THE LAST PART IS ROUNDED UP. The earlier ones are exactly the part size, which is what
  //   lets a reader work out where the padding is.
  const { plan, sealedBytes, credits } = planAndPrice(size, partSize, rule);

  if (options.dryRun === true) {
    // ⛔ Nothing above this line touched the network and nothing below it runs. The file was not
    //    even read — the price is arithmetic on its size, and the server does the same arithmetic.
    if (options.json) {
      say(
        JSON.stringify({
          dryRun: true,
          name,
          bytes: size,
          sealedBytes,
          parts: plan.length,
          partSize,
          credits,
          epochs: UPLOAD_EPOCHS,
        }),
      );
      return 0;
    }
    say(`${name}  ${size} bytes  →  ${credits} credit${credits === 1 ? "" : "s"}`);
    if (plan.length > 1) say(`  in ${plan.length} parts of up to ${partSize} bytes`);
    say(``);
    say(`  Nothing was sent and nothing was charged. Run the same command without --dry-run`);
    say(`  to upload it.`);
    return 0;
  }

  // ⛔ ASKED AFTER THE PRICE IS KNOWN AND BEFORE ANYTHING LEAVES. Working the price out is local
  //    and free, so doing it first costs nothing and lets the refusal name a real number instead
  //    of a warning about spending in general. `--dry-run` returns above this line and never asks.
  requireConsent("spend");

  // ⛔ Resolved from the list read above — which happened BEFORE the money moves, so a rolled-back
  //    or forked list stops the upload rather than being discovered after it is paid for.
  const parentId = folderIdFor(options.to, list.manifest?.entries ?? []);

  // ⛔ `--json` promises one JSON document and nothing else, so it gets a reporter that says
  //    nothing. Everything else reports to STDERR, where it cannot land in a redirected answer.
  const progress = new Progress(options.json === true ? silentSink() : stderrSink(), "uploading");
  const protocol = createBlobProtocol(network, sealedBytes, (sent, total) =>
    progress.update(sent, total),
  );
  const currentEpoch = await readCurrentEpoch(network);

  if (!options.json) {
    say(`${name}  ${size} bytes  →  ${credits} credit${credits === 1 ? "" : "s"}`);
    if (plan.length > 1) {
      say(`  in ${plan.length} parts — each one is bought separately and can be finished later`);
    }
  }
  const steps: string[] = [];
  const onStep = (step: FileUploadStep): void => {
    steps.push(step.step);
    if (options.json) return;
    if (step.step === "planning") return;
    if (step.step === "hashing") {
      say(`  reading ${size} bytes`);
      return;
    }
    // ⚠ Only said for a file that HAS several parts. On a one-part file the number is noise.
    const where = step.parts > 1 ? `  [${step.partIndex + 1}/${step.parts}]` : "";
    if (step.step === "sealing") say(`  sealing${where} ${step.bytes} bytes`);
    if (step.step === "resuming") say(`  picking up reservation ${step.ledgerId} (${step.state})${where}`);
    if (step.step === "encoding") say(`  preparing${where} ${step.bytes} sealed bytes`);
    if (step.step === "reserving") say(`  buying storage${where}`);
    if (step.step === "uploading") say(`  uploading${where} ${step.bytes} bytes to ${step.relayUrl}`);
    if (step.step === "certifying") {
      // The live line is finished before anything else prints, or the next line lands on top of it.
      progress.done();
      say(`  certifying${where}`);
    }
    if (step.step === "committing") say(`  saving to the drive`);
  };

  let result;
  try {
    result = await uploadFile({
      api: createUploadApi(server, key.key),
      protocol,
      crypt,
      dataKey,
      source: fileSource(localPath, size),
      name,
      parentId,
      destination,
      relayUrl: protocol.relayUrl,
      epochs: UPLOAD_EPOCHS,
      currentEpoch,
      partSize,
      padding: { rule, unitBytes: CREDIT_BYTES },
      onStep,
    });
  } finally {
    // ⛔ Also on the way out of a failure. A half-written progress line would otherwise sit in
    //    front of the error message, which is the one line that must be readable.
    progress.done();
    dataKey.fill(0);
  }

  const now = Date.now();
  // ⛔ FROM `result.entry`, NOT FROM THIS RUN. The key that opens the stored bytes is the key they
  //    were sealed with, which on a resume belongs to the run that sealed them. Writing this run's
  //    key would produce a file that is paid for, present, correctly named and impossible to open.
  const added = await addEntry({
    server,
    apiKey: key.key,
    code: resolved.code,
    accountId: identity.accountId,
    ...(asked !== undefined ? { onCollision: asked } : {}),
    entry: {
      id: result.itemId,
      // ⚠ The FRESHLY resolved folder, not the record's. The reservation key already covers the
      //   destination as typed, so both runs asked for the same path — and if that folder has
      //   since been removed, resolving again is what says so instead of writing into a folder id
      //   that no longer exists.
      parentId,
      kind: 1,
      name: result.entry.name,
      size: result.entry.plaintextLen,
      createdAt: now,
      updatedAt: now,
      dekWrapped: result.entry.dekWrapped,
      contentHashCt: result.entry.contentHashCt,
    },
  });
  // ⛔ ONLY NOW, AND EVERY PART. Until the entry is in the list the file is paid for and invisible,
  //    and the records are the only thing that lets a second run finish the job without spending
  //    again. Clearing the file-level one first would leave a run able to commit a second time.
  clearItemRecord(result.fileKey);
  for (const record of partKeysOf(result.fileKey, result.parts)) clearReservation(record);

  // ⛔ THE DISPLACED FILE IS TOLD TO THE SERVER ONLY NOW, and only after the new one is in the
  //    list. Until this line the person still had the file they started with.
  // ⚠ A failure here leaves it hidden in this account's trash while the server still counts it as
  //   live. That is the harmless direction: it stays restorable, it still expires on its own, and
  //   `nmts rm` on it again finishes the job. The other order — server first — would show a live
  //   file the server has already trashed, which is the one state a person cannot act on.
  if (added.replaced) await setTrashed(server, key.key, added.replaced.id, true);

  if (options.json) {
    say(
      JSON.stringify({
        id: result.itemId,
        name: added.name,
        bytes: size,
        sealedBytes,
        parts: plan.length,
        credits: result.resumed ? 0 : credits,
        resumed: result.resumed,
        renamed: added.name !== name,
        ...(added.replaced ? { replacedIntoTrash: added.replaced.id } : {}),
        fileListVersion: added.seq,
      }),
    );
    return 0;
  }
  say(`  saved as ${added.name}`);
  if (added.replaced) {
    say(``);
    say(`  A file called ${name} was already there. It is in the trash now — ${BINARY_NAME} restore`);
    say(`  brings it back for 30 days. This machine is set to overwrite: ${BINARY_NAME} on-collision`);
  } else if (added.name !== name) {
    say(``);
    say(`  A file called ${name} was already there, so this one was numbered rather than`);
    say(`  replacing it. This machine is set to rename: ${BINARY_NAME} on-collision`);
  }
  if (result.resumed) {
    say(``);
    say(`  This finished an upload a previous run had already paid for. Nothing was charged now.`);
  }
  return 0;
}
