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
// ⛔ READ ONLY, AND IT SAYS SO. Writing costs credits, and spending is one of the three things this
//    tool asks a person about once per machine. Answering PUT before that agreement exists would
//    spend somebody's money because a sync tool decided to. Uploads come next, behind that gate.

import { fetchFile } from "../download.ts";
import { NmtsError } from "../errors.ts";
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

  const server = createGateway({
    credential,
    source: {
      entries,
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
        readOnly: true,
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
    say(`  ⛔ READ ONLY. Listing and downloading work; uploading and deleting do not yet.`);
    say(`  ⛔ These credentials were made for this run and are stored nowhere. They stop working`);
    say(`     the moment this command does.`);
    say(`  ⚠ A file uploaded from another device can take ${LIST_CACHE_MS / 1000}s to appear here.`);
    say(``);
    say(`  Press Ctrl-C to stop. \`${BINARY_NAME} s3 --json\` prints the same thing in one line.`);
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
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
