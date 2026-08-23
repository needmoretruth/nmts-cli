// `nmts get <path>` — one file back out, decrypted and checked.
//
// ⚠ IT REFUSES RATHER THAN WRITES A HALF-RIGHT FILE. Every failure below happens before anything
//   reaches the disk: a wrong key, a part that will not decrypt, parts that do not add up to the
//   file the list describes, or a whole-file hash that does not match. A file on disk is a claim
//   that it is the file, and a partial one makes that claim silently.
//
// ⛔ IT WILL NOT OVERWRITE. An agent that re-runs a command should not destroy what the previous
//   run produced, and neither should a person who forgot the file was there. `--force` is the way
//   to say otherwise, out loud.

import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { identityOf } from "../account.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, readCredentialsFile, resolveApiKey, resolveAccountCode } from "../credentials.ts";
import { fetchFile } from "../download.ts";
import { NmtsError, NotLoggedInError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";

export interface GetOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Where to write it. Defaults to the file's own name, in the working directory. */
  out?: string | undefined;
  /** Overwrite an existing file. Off by default, and saying so is the point. */
  force?: boolean;
  json?: boolean;
  write?: (line: string) => void;
}

/** Full path of an entry, from the drive root. Cycles cannot loop forever. */
function pathOf(entry: ManifestEntry, byId: Map<string, ManifestEntry>): string {
  const parts = [entry.name];
  const seen = new Set<string>([entry.id]);
  let parent = entry.parentId;
  while (parent !== null) {
    const node = byId.get(parent);
    if (node === undefined || seen.has(node.id)) break;
    seen.add(node.id);
    parts.unshift(node.name);
    parent = node.parentId;
  }
  return parts.join("/");
}

export async function get(target: string | undefined, options: GetOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (target === undefined || target === "") {
    throw new NmtsError("Say which file to get.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} get <path>\` — the path as \`${BINARY_NAME} ls\` prints it.`,
    });
  }
  const resolved = resolveAccountCode();
  if (resolved === null) throw new NotLoggedInError(BINARY_NAME, CODE_ENV_VAR);
  const key = resolveApiKey();
  if (key === null) {
    throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
      exitCode: 3,
      nextStep:
        `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
        `it with \`${BINARY_NAME} login\`.`,
    });
  }

  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const chain = resolveNetwork(server, options.network ?? stored?.network);
  const identity = await identityOf(resolved.code);

  const list = await readFileList(server, key.key, resolved.code, identity.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to get.", { exitCode: 4 });
  }

  const byId = new Map(list.manifest.entries.map((e) => [e.id, e]));
  const wanted = target.replace(/^\.?\//, "");
  const matches = list.manifest.entries.filter(
    (e) => e.deletedAt === undefined && e.kind === 1 && pathOf(e, byId) === wanted,
  );
  const entry = matches[0];
  if (entry === undefined) {
    // ⛔ Say whether the name exists at all elsewhere. "not found" when the file is in the trash,
    //    or is a folder, sends somebody looking for a typo they did not make.
    const trashed = list.manifest.entries.some((e) => e.deletedAt !== undefined && pathOf(e, byId) === wanted);
    const folder = list.manifest.entries.some((e) => e.kind === 0 && pathOf(e, byId) === wanted);
    throw new NmtsError(`No file at "${wanted}".`, {
      exitCode: 4,
      nextStep: trashed
        ? "It is in the trash. Restore it in a browser first."
        : folder
          ? "That is a folder. This version gets one file at a time."
          : `\`${BINARY_NAME} ls\` prints the paths this account holds.`,
    });
  }
  if (matches.length > 1) {
    throw new NmtsError(`"${wanted}" names ${matches.length} files in this account.`, {
      exitCode: 4,
      nextStep: "Nothing was written. Rename one of them in a browser, then try again.",
    });
  }
  if (entry.dekWrapped === undefined) {
    throw new NmtsError(`The file list holds no key for "${wanted}".`, {
      exitCode: 4,
      nextStep: "Without it nothing can open the stored bytes. Open the account in a browser.",
    });
  }

  const destination = resolve(options.out ?? basename(entry.name));
  const fetched = await fetchFile({
    base: server,
    apiKey: key.key,
    accountCode: resolved.code,
    itemId: entry.id,
    size: entry.size,
    dekWrapped: entry.dekWrapped,
    contentHashCt: entry.contentHashCt,
    chain,
  });

  try {
    writeFileSync(destination, fetched.bytes, { flag: options.force === true ? "w" : "wx", mode: 0o600 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? Reflect.get(error, "code") : null;
    if (code === "EEXIST") {
      throw new NmtsError(`${destination} already exists.`, {
        exitCode: 4,
        nextStep: "Nothing was written. Pass --out to choose another name, or --force to replace it.",
      });
    }
    throw error;
  }

  if (options.json) {
    say(
      JSON.stringify({
        path: wanted,
        writtenTo: destination,
        bytes: fetched.bytes.length,
        parts: fetched.partCount,
        contentHashChecked: fetched.contentHashChecked,
      }),
    );
    return 0;
  }
  say(`${destination}  ${fetched.bytes.length} bytes  from ${fetched.partCount} stored part${fetched.partCount === 1 ? "" : "s"}`);
  // ⛔ Said out loud when it is absent. "Verified" and "nothing to verify against" are different
  //    facts, and only one of them means the bytes were checked.
  if (!fetched.contentHashChecked) {
    say(``);
    say(`  This file has no recorded hash in the file list, so nothing here could check the whole`);
    say(`  file against one. Every part still decrypted under this account's key.`);
  }
  return 0;
}
