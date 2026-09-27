// `nmts handover make` and `nmts handover open` — handing one file to one account outside NMTS.
//
// ⛔ MAKE records nothing on the server. It reads this account's own file list and the stored
//    pieces of the file, and — only when the recipient is given as a public code rather than a
//    public code file — asks the server for the recipient's published identity, exactly as `share`
//    does. No share row is written: the handover is a file on this disk, passed on by the person.
//
// ⛔ OPEN asks the NMTS server nothing, and needs no API key: the file carries everything, the
//    NMTS key opens it, and the pieces come from Walrus aggregators.
//
// ⛔ A HANDOVER CANNOT BE TAKEN BACK. There is no row to delete. The recipient can download the file
//    until its storage ends or its stored bytes are destroyed; removing it from the drive (`rm`,
//    `erase`) does neither. The review printed before `--yes` says so.
//
// ⚠ `--out` MEANS THE SAME FILE-PATH THING EVERYWHERE: `make` writes the handover file there, `open`
//   writes the received file there, as `receive --out` does. Without it, `make` writes
//   `nmts-handover-<date>.nmtshandover` and `open` writes the sender's name — its last segment only —
//   in the current directory.

import { constants, accessSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { request } from "../api.ts";
import { requireAccountCode } from "../code-access.ts";
import { requireConsent } from "../consent.ts";
import { AAD, DERIVED, loadCrypto } from "../crypto.ts";
import { fetchKnownParts } from "../download.ts";
import type { PartView } from "../download-part.ts";
import { fileSink } from "../download-sink-node.ts";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { checkHandoverName, isHandoverNetwork, makeHandoverText, openHandoverText, readPublicCodeFileText } from "../handover.ts";
import { readFileList } from "../manifest.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { destinationFor } from "../safe-path.ts";
import { resolveServer } from "../server.ts";
import { readCredentialsFile } from "../credentials.ts";
import { openSession } from "../session.ts";
import { addressFromTyped, identityMatches, shareKeysOf } from "../share.ts";
import {
  handoverFileName,
  MAX_HANDOVER_FILE_BYTES,
  MAX_PUBLIC_CODE_FILE_BYTES,
  type HandoverNetwork,
  type HandoverPart,
} from "../shared/lib/share/handover-format.ts";
import { NETWORK_WALRUS } from "../shared/lib/storage-network.ts";

export interface HandoverOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** `make`: the recipient — a public code, or the path of their public code file. */
  to?: string | undefined;
  /** `make`: the handover file to write. `open`: the file to save the received file as. */
  out?: string | undefined;
  force?: boolean;
  yes?: boolean;
  json?: boolean;
  write?: (line: string) => void;
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

export async function handover(sub: string | undefined, operand: string | undefined, options: HandoverOptions = {}): Promise<number> {
  if (sub === "make") return await make(operand, options);
  if (sub === "open") return await open(operand, options);
  throw new NmtsError("Say `make` or `open`.", {
    exitCode: 2,
    nextStep:
      `\`${BINARY_NAME} handover make <path> --to <public code | public code file>\` writes a handover file; ` +
      `\`${BINARY_NAME} handover open <file>\` saves the file it carries.`,
  });
}

function networkOf(value: string): HandoverNetwork {
  if (!isHandoverNetwork(value)) throw new NmtsError(`Handover files exist on mainnet and testnet, not ${value}.`, { exitCode: 2 });
  return value;
}

/** Read a small file someone passed on: refused above `max` bytes, and every failure said plainly. */
function readPassedFile(path: string, max: number, what: string): string {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new NmtsError(`Could not read ${path} as a ${what}.`, { exitCode: 2, nextStep: "Nothing was written." });
  }
  if (size > max) {
    throw new NmtsError(`${path} is too large to be a ${what}.`, { exitCode: 2, nextStep: "Nothing was written." });
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new NmtsError(`Could not read ${path}.`, { exitCode: 4, nextStep: "Nothing was written." });
  }
}

/** Refuse an output path that cannot be written, before anything is asked of anybody. */
function checkOutput(out: string, force: boolean): void {
  if (!force && existsSync(out)) {
    throw new NmtsError(`${out} already exists.`, {
      exitCode: 4,
      nextStep: "Nothing was written. Pass --out to choose another name, or --force to replace it.",
    });
  }
  try {
    accessSync(dirname(out), constants.W_OK);
  } catch {
    throw new NmtsError(`Cannot write into ${dirname(out)}.`, {
      exitCode: 4,
      nextStep: "Nothing was written. Pass --out with a path in a directory that exists and can be written.",
    });
  }
}

async function make(target: string | undefined, options: HandoverOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (target === undefined || target === "" || options.to === undefined || options.to === "") {
    throw new NmtsError("Say which file, and whom to hand it to.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} handover make <path> --to <public code | public code file>\`.`,
    });
  }
  const force = options.force === true;
  const out = resolve(options.out ?? handoverFileName(new Date()));
  checkOutput(out, force);
  const crypt = await loadCrypto();
  // ⛔ A file that exists is read as a public code file; anything else must be a public code, whose
  //    check symbol is tested here before the network is asked anything.
  const codeFile = existsSync(options.to)
    ? readPublicCodeFileText(crypt, readPassedFile(options.to, MAX_PUBLIC_CODE_FILE_BYTES, "public code file"))
    : null;
  const typedAddress = codeFile === null ? addressFromTyped(crypt, options.to) : null;

  const session = await openSession({ server: options.server, network: options.network });
  const network = networkOf(resolveNetwork(session.server, session.network));
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to hand over.", { exitCode: 4 });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), { nothingHappened: "Nothing was written." });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder. Nothing was written — a handover carries one file.",
    });
  }
  if (entry.dekWrapped === undefined || entry.contentHashCt === undefined) {
    throw new NmtsError(`The file list holds no ${entry.dekWrapped === undefined ? "key" : "hash"} for "${entry.name}".`, {
      exitCode: 4,
      nextStep: "A handover carries both — the key that opens the file and the hash the recipient checks. Nothing was written.",
    });
  }
  checkHandoverName(entry.name, entry.size, network);
  const recipientShown = codeFile?.display ?? options.to;

  // ⛔ The same unlock as `share` — it gives another account this file — and asked every time.
  requireConsent("share");
  if (options.yes !== true) {
    say(`Would write a handover file for "${fullPathOf(index, entry)}", sealed to ${recipientShown}, to ${out}.`);
    say(``);
    say(`⛔ A handover cannot be taken back. The recipient can download the file until its storage ends or its stored bytes are destroyed.`);
    say(`   Removing the file from your drive does not stop it.`);
    say(`Nothing was written. To go ahead:  ${goAhead(target, options)}`);
    say(`⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`);
    return 5;
  }

  const keys = shareKeysOf(crypt, session.code);
  const derived = crypt.kdf_derive(crypt.account_code_parse(session.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  let dek: Uint8Array | null = null;
  let digest: Uint8Array | null = null;
  try {
    dek = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.dekWrap), new Uint8Array(Buffer.from(entry.dekWrapped, "base64url")));
    digest = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.contentHash), new Uint8Array(Buffer.from(entry.contentHashCt, "base64url")));
    dataKey.fill(0);

    let recipientIdentity: Uint8Array;
    let recipientAddress: Uint8Array;
    if (codeFile !== null) {
      recipientIdentity = codeFile.identity;
      recipientAddress = codeFile.address;
    } else {
      if (typedAddress === null) throw new NmtsError("No recipient was given.", { exitCode: 2 });
      recipientAddress = typedAddress;
      const answer: unknown = await request(session.server, `/v1/share-recipients/${encodeURIComponent(b64(recipientAddress))}`, {
        token: session.apiKey,
      });
      const identityB64 = isRecord(answer) ? answer["share_public_key"] : null;
      if (typeof identityB64 !== "string") {
        throw new NmtsError("That public code has never published an identity to seal to.", {
          exitCode: 4,
          nextStep: "Nothing was written. Ask the recipient for their public code file instead.",
        });
      }
      recipientIdentity = new Uint8Array(Buffer.from(identityB64, "base64url"));
      if (!identityMatches(crypt, recipientIdentity, recipientAddress)) {
        throw new NmtsError("The identity the server returned is not the one that public code names.", {
          exitCode: 1,
          nextStep: "Nothing was written. Sealing to it would hand the file to somebody else.",
        });
      }
    }
    if (Buffer.from(recipientAddress).equals(Buffer.from(keys.address))) {
      throw new NmtsError("That is your own public code.", { exitCode: 2, nextStep: "Nothing was written." });
    }

    const parts = partsOf(await request(session.server, `/v1/items/${encodeURIComponent(entry.id)}/parts`, { token: session.apiKey }));
    const text = makeHandoverText(crypt, {
      keys,
      recipientIdentity,
      recipientAddress,
      dek,
      itemId: entry.id,
      name: entry.name,
      size: entry.size,
      digest,
      parts,
      network,
    });
    try {
      // ⚠ 0600: nothing in it is readable without the recipient's key, but whom it is from is.
      writeFileSync(out, text, { flag: force ? "w" : "wx", mode: 0o600 });
    } catch (error) {
      const code = isRecord(error) && typeof error["code"] === "string" ? ` (${error["code"]})` : "";
      throw new NmtsError(`Could not write ${out}${code}.`, {
        exitCode: 4,
        nextStep: "If it already exists, name another file with --out or replace it with --force.",
      });
    }
    const shown = codeFile?.display ?? crypt.share_address_display(recipientAddress);
    if (options.json === true) {
      say(JSON.stringify({ out, name: entry.name, recipient: shown }));
      return 0;
    }
    say(`${entry.name}  →  ${shown}`);
    say(`  handover file  ${out}`);
    say(``);
    say(`  Pass it on yourself. Only their NMTS key decrypts the file inside it.`);
    if (codeFile === null) say(`  Looking up a public code tells NMTS whom you looked up. A public code file does not.`);
    return 0;
  } finally {
    dataKey.fill(0);
    dek?.fill(0);
    digest?.fill(0);
    keys.wipe();
  }
}

/** The exact command that goes ahead: every option that was given, and `--yes`. */
function goAhead(target: string, options: HandoverOptions): string {
  const words = [BINARY_NAME, "handover", "make", JSON.stringify(target), "--to", JSON.stringify(options.to ?? "")];
  if (options.out !== undefined) words.push("--out", JSON.stringify(options.out));
  if (options.force === true) words.push("--force");
  if (options.server !== undefined) words.push("--server", JSON.stringify(options.server));
  if (options.network !== undefined) words.push("--network", JSON.stringify(options.network));
  words.push("--yes");
  return words.join(" ");
}

/** The stored pieces, as the server lists them for the file's owner. */
function partsOf(value: unknown): HandoverPart[] {
  const rows = isRecord(value) ? value["parts"] : null;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new NmtsError("The server lists no stored pieces for this file.", { nextStep: "Nothing was written." });
  }
  const parsed = rows.map((row: unknown) => {
    if (!isRecord(row)) throw new NmtsError("A stored piece was not described in a shape this version reads.");
    const index = row["part_index"];
    const kind = row["storage_kind"];
    const where = row["network"] ?? NETWORK_WALRUS;
    const blob = row["blob_id"];
    const patch = row["patch_id"];
    const len = row["sealed_len"];
    const exp = row["expiry_epoch"];
    if (typeof index !== "number" || typeof kind !== "number" || typeof blob !== "string" || typeof len !== "number" || typeof exp !== "number") {
      throw new NmtsError("A stored piece was not described in a shape this version reads.");
    }
    // ⛔ The recipient fetches from Walrus aggregators and nothing else.
    if (where !== NETWORK_WALRUS || (kind !== 0 && kind !== 1)) {
      throw new NmtsError("A piece of this file is not stored on Walrus in a way a handover can carry.", { nextStep: "Nothing was written." });
    }
    const isPatch = kind === 1;
    if (isPatch && typeof patch !== "string") throw new NmtsError("A quilt piece came without its patch id.");
    return { index, part: { blob: isPatch ? null : blob, patch: isPatch && typeof patch === "string" ? patch : null, len, exp } };
  });
  parsed.sort((a, b) => a.index - b.index);
  if (parsed.some((p, i) => p.index !== i)) throw new NmtsError("The stored pieces are not numbered 0, 1, … in order.");
  return parsed.map((p) => p.part);
}

async function open(file: string | undefined, options: HandoverOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (file === undefined || file === "") {
    throw new NmtsError("Say which handover file to open.", { exitCode: 2, nextStep: `\`${BINARY_NAME} handover open <file>\`.` });
  }
  const text = readPassedFile(file, MAX_HANDOVER_FILE_BYTES, "handover file");
  // ⛔ No session: that would demand an API key, and this path talks to no NMTS server. Only the
  //    NMTS key (to open the file) and the network (which aggregators to ask) are needed.
  const code = await requireAccountCode();
  const stored = readCredentialsFile();
  const chain = resolveNetwork(resolveServer(options.server ?? stored?.server), options.network ?? stored?.network);
  const crypt = await loadCrypto();
  const keys = shareKeysOf(crypt, code.code);
  let opened: ReturnType<typeof openHandoverText> | null = null;
  try {
    opened = openHandoverText(crypt, keys, text, networkOf(chain));
    // ⛔ The name is the SENDER'S choice: only its last segment, in the current directory.
    const destination = options.out !== undefined ? resolve(options.out) : destinationFor(".", opened.name);
    const parts: PartView[] = opened.parts.map((p, i) => ({
      part_index: i,
      storage_kind: p.patch !== null ? 1 : 0,
      network: NETWORK_WALRUS,
      blob_id: p.blob ?? p.patch ?? "",
      ...(p.patch !== null ? { patch_id: p.patch } : {}),
    }));
    const fetched = await fetchKnownParts({
      parts,
      size: opened.size,
      dek: opened.dek,
      expected: opened.digest,
      chain,
      sink: fileSink(destination, { force: options.force === true }),
    });
    if (options.json === true) {
      say(JSON.stringify({ name: opened.name, bytes: fetched.byteCount, from: opened.sender, out: destination, expiryEpoch: opened.expiryEpoch }));
      return 0;
    }
    say(`${opened.name}  ${fetched.byteCount} bytes`);
    say(`  from ${opened.sender}`);
    say(`  saved to ${destination}, checked against the hash the sender sealed with it`);
    return 0;
  } finally {
    opened?.dek.fill(0);
    opened?.digest.fill(0);
    keys.wipe();
  }
}
