// Reading bytes back from the Walrus storage network.
//
// ⛔ THE AGGREGATOR IS NOT TRUSTED, and nothing here pretends otherwise. Whatever these hosts hand
//    back goes straight into the NCF-3 stream decryptor, which authenticates every chunk under the
//    file's own key. A host that returns the wrong bytes — by mistake or on purpose — produces a
//    decryption failure, never a quietly wrong file. What an aggregator CAN do is refuse to serve,
//    or serve nothing, which is why more than one is listed.
//
// ⛔ THE HOST LIST IS WRITTEN IN THREE LANGUAGES and `deploy/check-walrus-hosts.mjs` set-compares
//    them: here, the browser build, and the standalone recovery tool. One copy going stale shows
//    up as "file not found", which reads as "the file is gone" — so the machine holds them level
//    rather than a person remembering to.
import { NmtsError } from "./errors.ts";

/** Curated Walrus aggregator (read) endpoints per network, preference order. */
export const AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>> = {
  testnet: ["https://aggregator.walrus-testnet.walrus.space"],
  mainnet: ["https://aggregator.walrus-mainnet.walrus.space"],
};

/** How long one host gets before the next is tried. A read that stalls is a read that failed. */
export const READ_TIMEOUT_MS = 60_000;

/**
 * Point reads at somebody else's aggregator, or at a development stack.
 *
 * ⚠ It replaces the list rather than adding to it, and that is deliberate: a run should read from
 *   where it was told to read, not from there AND the public hosts. Comma-separated for more
 *   than one, tried in the order given.
 */
export const AGGREGATOR_ENV_VAR = "NMTS_AGGREGATOR";

function fromEnvironment(): readonly string[] | null {
  const raw = process.env[AGGREGATOR_ENV_VAR];
  if (raw === undefined) return null;
  const hosts = raw.split(",").map((h) => h.trim()).filter((h) => h !== "");
  return hosts.length > 0 ? hosts : null;
}

export interface ReadOptions {
  /** Override the host list — for a development stack, or an aggregator somebody runs themselves. */
  hosts?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

function hostsFor(network: string, options: ReadOptions): readonly string[] {
  if (options.hosts !== undefined && options.hosts.length > 0) return options.hosts;
  const chosen = fromEnvironment();
  if (chosen !== null) return chosen;
  const known = AGGREGATOR_HOSTS[network];
  if (known === undefined) {
    throw new NmtsError(`No storage-network hosts are known for "${network}".`, {
      exitCode: 2,
      nextStep: "Use --network mainnet or --network testnet.",
    });
  }
  return known;
}

/**
 * Fetch one stored object, trying each host in order.
 *
 * ⛔ It reports what it tried. A read that fails everywhere is either a blob that is gone, a
 *    network that is wrong, or hosts that are all down, and those need different next steps — a
 *    bare "not found" would send somebody looking for the wrong one.
 */
async function readFrom(
  network: string,
  pathOf: (host: string) => string,
  what: string,
  options: ReadOptions,
): Promise<Uint8Array> {
  const hosts = hostsFor(network, options);
  const tried: string[] = [];
  for (const host of hosts) {
    const url = pathOf(host.replace(/\/$/, ""));
    const timer = AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS);
    const signal =
      options.signal === undefined ? timer : AbortSignal.any([timer, options.signal]);
    try {
      const response = await fetch(url, { signal, redirect: "follow" });
      if (!response.ok) {
        tried.push(`${host} → ${response.status}`);
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      // ⛔ The reason is kept, not flattened to "failed". A timeout and a refused connection mean
      //    different things, and the last host's reason is what the person reads.
      tried.push(`${host} → ${error instanceof Error ? error.message : "no answer"}`);
    }
  }
  throw new NmtsError(`${what} could not be read from the ${network} storage network.`, {
    exitCode: 5,
    nextStep:
      `Tried: ${tried.join(" · ")}. If every host answered 404, either the bytes are gone or ` +
      `this is the wrong network — the same identifier does not exist on both.`,
  });
}

/** Whole-blob read: `GET {aggregator}/v1/blobs/{blobId}`. */
export function readBlob(network: string, blobId: string, options: ReadOptions = {}): Promise<Uint8Array> {
  return readFrom(
    network,
    (host) => `${host}/v1/blobs/${encodeURIComponent(blobId)}`,
    `Blob ${blobId}`,
    options,
  );
}

/**
 * Quilt-patch read: `GET {aggregator}/v1/blobs/by-quilt-patch-id/{patchId}`.
 *
 * A quilt is one stored blob holding many small files; the patch id addresses one of them. Files
 * under 64 MiB share a quilt, so this is the common path rather than the exotic one.
 */
export function readQuiltPatch(
  network: string,
  patchId: string,
  options: ReadOptions = {},
): Promise<Uint8Array> {
  return readFrom(
    network,
    (host) => `${host}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(patchId)}`,
    `Quilt patch ${patchId}`,
    options,
  );
}
