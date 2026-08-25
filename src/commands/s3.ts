// `nmts s3` — serve this account's drive to any program that speaks S3.
//
// ⛔ WHY THIS EXISTS. Backup programs, sync tools and agent frameworks already know how to talk to
//    S3. They do not know how to talk to this. Rather than ask every one of them to learn, the tool
//    speaks the protocol they already speak, on this machine, where the account code already is.
//
// ⛔ WHAT IT IS NOT. It is not a bridge to the internet and cannot be made into one: the address it
//    binds is loopback and there is no option to change that (`s3/server.ts` says why). Nothing is
//    stored: the access key it prints is made fresh every time it starts and dies with it.
//
// ⛔ WRITING IS BEHIND THE SPENDING AGREEMENT, AND SAYS SO WHEN IT IS NOT THERE. Uploading costs
//    credits, and spending is one of the three things this tool asks a person about once per
//    machine -- and a gateway cannot ask, because its caller is a program and its stdin is not a
//    terminal. So the agreement has to exist before it starts: without it the drive is served read
//    only and every write is refused with the sentence naming the command that grants it.

import { createWriteStream } from "node:fs";
import { mkdir as makeDir, rm as removeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import { isGranted } from "../consent.ts";
import { createStaging } from "../s3/staging.ts";
import { refusalFor, verdictForKey } from "../s3/same-file.ts";
import { fetchFile } from "../download.ts";
import { NmtsError } from "../errors.ts";
import { ensureFolderPath } from "./organise.ts";
import { put } from "./put.ts";
import { rm } from "./trash.ts";
import { readFileList } from "../manifest.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { BUCKET } from "../s3/listing.ts";
import { BIND_ADDRESS, createGateway, newCredential } from "../s3/server.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";

/** MinIO's port, which is what most S3 tools already have in their examples. */
export const DEFAULT_PORT = 9000;

/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts.
 */
export const LIST_CACHE_MS = 5_000;

export interface S3Options {
  server?: string | undefined;
  network?: string | undefined;
  /** Which port to listen on. Loopback either way. */
  port?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /** Resolves when the caller wants the gateway to stop. Tests pass one; a person presses Ctrl-C. */
  until?: Promise<void>;
}

function portOf(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new NmtsError(`--port needs a number between 1 and 65535, not ${raw}.`, { exitCode: 2 });
  }
  return port;
}

export async function s3(options: S3Options = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const port = portOf(options.port);
  const session = await openSession({ server: options.server, network: options.network });
  const chain = resolveNetwork(session.server, session.network);
  const credential = newCredential();

  let cached: readonly ManifestEntry[] = [];
  let cachedAt = 0;
  const entries = async (): Promise<readonly ManifestEntry[]> => {
    if (Date.now() - cachedAt < LIST_CACHE_MS) return cached;
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    cached = list.manifest === null ? [] : list.manifest.entries;
    cachedAt = Date.now();
    return cached;
  };

  /**
   * Where the pieces of a multipart upload wait until they are one file.
   *
   * ⛔ ONE DIRECTORY PER RUN, 0700, REMOVED WHEN THE COMMAND STOPS. Pieces are somebody's
   *    plaintext; leaving them in a shared temporary directory under a predictable name would put
   *    them where any other account on the machine could read them, for as long as the upload
   *    takes and afterwards.
   */
  const stagingRoot = join(tmpdir(), `nmts-s3-${randomUUID()}`);
  /**
   * Store one local file at a drive key, making the folders above it if they are missing.
   *
   * ⛔ THE SAME-FILE QUESTION IS ANSWERED HERE AND NOWHERE ELSE.
   *    Both ways of uploading — one PUT, or pieces staged and joined — end in this
   *    function, so a rule written here cannot disagree with itself; written in the protocol layer
   *    it would have to be written twice, once for each, and the two would differ the first time
   *    one of them changed. What is compared is the plaintext's SHA-256 against the one this
   *    account sealed when the file was first stored.
   *
   * ⛔ IDENTICAL CONTENT IS NOT AN ERROR. Nothing is sent and nothing is charged, and the caller
   *    is told the upload finished — because the statement it was making, "that file is at that
   *    key", is true. Answering 409 there is what made every backup run fail on every file it had
   *    already stored, and a sync tool writes 409 down as a failure.
   */
  const storeFile = async (key: string, path: string): Promise<void> => {
    const at = key.lastIndexOf("/");
    const folder = at < 0 ? undefined : key.slice(0, at);
    const name = at < 0 ? key : key.slice(at + 1);

    const verdict = await verdictForKey(await entries(), key, session.code, path);
    // ⭐ Already there, byte for byte. This is the whole point: an unchanged file costs nothing to
    //    re-offer, so a backup that runs nightly stops paying for the nights nothing changed.
    if (verdict === "same") {
      say(`same ${key} — already stored, nothing sent`);
      return;
    }
    if (verdict !== "free") throw refusalFor(verdict, key);

    if (folder !== undefined && folder !== "") await ensureFolderPath(session, folder);
    await put(path, {
      server: options.server,
      network: options.network,
      ...(folder === undefined || folder === "" ? {} : { to: folder }),
      name,
      write: () => undefined,
    });
    cachedAt = 0;
  };

  // ⛔ WRITING IS OFF UNLESS THIS MACHINE ALREADY AGREED TO SPENDING. A gateway cannot ask: its
  //    caller is a program and its stdin is not a terminal. So the question is answered before it
  //    starts, and where the answer is no every write says so and nothing is charged.
  const writable = isGranted("spend");

  const server = createGateway({
    credential,
    source: {
      entries,
      ...(writable
        ? {
            write: {
              // ⛔ THE BODY IS SPOOLED TO A FILE FIRST, 0600, and deleted whatever happens. The
              //    upload path reserves storage, cuts parts and seals them from a file, and giving
              //    it a socket instead would mean either holding whole uploads in memory or
              //    writing a second upload path — and a second upload path is a second place for
              //    "what if the reservation succeeds and the part fails" to be got right.
              put: async (key, body, size) => {
                await makeDir(stagingRoot, { recursive: true, mode: 0o700 });
                const spool = join(stagingRoot, randomUUID());
                try {
                  await pipeline(body, createWriteStream(spool, { mode: 0o600 }));
                  const written = (await stat(spool)).size;
                  if (written !== size) {
                    throw new NmtsError(
                      `The upload said ${size} bytes and ${written} arrived. Nothing was stored.`,
                    );
                  }
                  await storeFile(key, spool);
                } finally {
                  await removeFile(spool, { force: true });
                }
              },
              multipart: createStaging(stagingRoot, storeFile),
              trash: async (object) => {
                await rm([`/${object.key}`], {
                  server: options.server,
                  network: options.network,
                  write: () => undefined,
                });
                cachedAt = 0;
              },
            },
          }
        : {}),
      // The real reader. The gateway takes it as a function so its own tests can be driven by a
      // real S3 client without an account, a network or anybody's credits.
      fetch: async (object, sink) => {
        const wrapped = object.entry.dekWrapped;
        if (wrapped === undefined) throw new NmtsError("That entry has no key in the file list.");
        await fetchFile({
          base: session.server,
          apiKey: session.apiKey,
          accountCode: session.code,
          itemId: object.entry.id,
          size: object.size,
          dekWrapped: wrapped,
          contentHashCt: object.entry.contentHashCt,
          chain,
          sink,
        });
      },
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new NmtsError(`Port ${port} on ${BIND_ADDRESS} is already taken.`, {
              exitCode: 4,
              nextStep: `Nothing was served. Pass --port with a free number.`,
            })
          : error,
      );
    });
    server.listen(port, BIND_ADDRESS, resolve);
  });

  const endpoint = `http://${BIND_ADDRESS}:${port}`;
  if (options.json === true) {
    say(
      JSON.stringify({
        endpoint,
        bucket: BUCKET,
        accessKeyId: credential.accessKeyId,
        secretAccessKey: credential.secretAccessKey,
        readOnly: !writable,
        listCacheMs: LIST_CACHE_MS,
      }),
    );
  } else {
    say(`  This account's drive is being served at ${endpoint}, to this machine only.`);
    say(``);
    say(`  endpoint        ${endpoint}`);
    say(`  bucket          ${BUCKET}`);
    say(`  access key id   ${credential.accessKeyId}`);
    say(`  secret key      ${credential.secretAccessKey}`);
    say(`  region          any — the signature carries whichever one the client used`);
    say(``);
    say(
      writable
        ? `  Listing, downloading, uploading and deleting all work. Uploading spends credits.`
        : `  ⛔ READ ONLY — this machine has not agreed to spending, so uploads and deletes are` +
            ` refused. \`${BINARY_NAME} consent grant spend\`, run by the person whose account this` +
            ` is, changes that.`,
    );
    say(`  ⚠ A file already in the drive is not replaced: uploading over one is refused, and a`);
    say(`     delete puts the old one in the trash for thirty days.`);
    say(`  ⛔ These credentials were made for this run and are stored nowhere. They stop working`);
    say(`     the moment this command does.`);
    say(`  ⚠ A file uploaded from another device can take ${LIST_CACHE_MS / 1000}s to appear here.`);
    say(``);
    say(`  Press Ctrl-C to stop. \`${BINARY_NAME} s3 --json\` prints the same thing in one line.`);
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      // Nothing half-uploaded outlives the command that was staging it.
      void removeFile(stagingRoot, { recursive: true, force: true });
      server.close(() => resolve());
      // A client holding a connection open must not keep the process alive after Ctrl-C.
      server.closeAllConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    void options.until?.then(stop);
  });
  return 0;
}
