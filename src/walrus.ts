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
import { AGGREGATOR_ENV_VAR, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./env-vars.ts";
import { NmtsError } from "./errors.ts";
import { host as runtime } from "./host.ts";
import { reach, reachFetch } from "./reach.ts";
import { raceHosts, type Reply } from "./read-race.ts";
import { REGISTRY_AGGREGATORS } from "./road-hosts.generated.ts";

/**
 * Curated Walrus aggregator (read) endpoints per network, preference order.
 *
 * ⭐ 2026-09-22: a SECOND one per network, so "if one is down we move on" is true rather than
 *    written. Both came from the canonical operator registry (https://docs.wal.app/operators.json)
 *    and both answered `GET /v1/api` with 200 the same day. The browser's table carries the full
 *    provenance and the reason each host and not another; this copy exists because this package
 *    imports nothing from that tree, and `deploy/check-walrus-hosts.mjs` set-compares the two.
 */
export const PINNED_AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>> = {
  testnet: [
    "https://aggregator.walrus-testnet.walrus.space",
    "https://walrus-testnet-aggregator.nodeinfra.com",
  ],
  mainnet: [
    "https://aggregator.walrus-mainnet.walrus.space",
    "https://sui-walrus-mainnet-aggregator.bwarelabs.com",
  ],
};

/**
 * ⭐ D51: the two rows above, then every other aggregator in Walrus's operator registry that served
 *    the probe blob (`deploy/gen-roads.mjs`, the same generated list the browser and its CSP read).
 *    A read asks them as a staggered race, so a dead row costs a second and a half, not a timeout.
 */
export const AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>> = {
  testnet: withRegistry("testnet"),
  mainnet: withRegistry("mainnet"),
};

function withRegistry(network: "testnet" | "mainnet"): readonly string[] {
  const pinned = PINNED_AGGREGATOR_HOSTS[network] ?? [];
  return [...pinned, ...REGISTRY_AGGREGATORS[network].filter((h) => !pinned.includes(h))];
}

/**
 * Curated Walrus upload-relay (write) endpoints per network, preference order.
 *
 * ⛔ A RELAY IS NOT AN AGGREGATOR, and the difference is money. The relay is named inside the
 *    register transaction the server pays a tip in, so the bytes have to go to the SAME host the
 *    reservation was made for. That is why a write picks its host BEFORE the storage is bought and
 *    then never moves: failing over to a second relay would push bytes nobody paid that relay for.
 *
 * ⭐ THE SECOND ROW (D51, 2026-11-10) is Studio Mirai's public relay, an operator in Walrus's registry
 *    whose relay the registry does not list: found by asking each registry operator's relay-shaped
 *    name for `/v1/tip-config` (two of 366 answered, this one on both networks). Its tip is 3,000,000
 *    MIST plus 60 per encoded KiB, above Mysten's, so it is the second choice and only on a wallet
 *    upload (the person pays it and sees it first; the treasury pays only the relays the chain
 *    service allows). Picked once at the start of a run, like the roads after it (`upload-road.ts`).
 *
 * ⭐ THE LATER ROADS ARE NOT ROWS HERE (D50 · D51): the storage nodes, then NMTS's own no-tip relay,
 *    chosen once at the start of a run, before the price, only when no relay here answers.
 */
export const RELAY_HOSTS: Readonly<Record<string, readonly string[]>> = {
  testnet: ["https://upload-relay.testnet.walrus.space", "https://upload-relay.testnet.walrus.mirai.cloud"],
  mainnet: ["https://upload-relay.mainnet.walrus.space", "https://upload-relay.mainnet.walrus.mirai.cloud"],
};

/**
 * Sui node endpoints per network, spoken to over gRPC-web (`sui-rpc.ts`), first-that-answers.
 *
 * ⛔ READ-MOSTLY, AND NOT TRUSTED WITH ANYTHING SECRET. Most commands ask one question here — how
 *    many shards the storage network has, which the erasure coding needs; the wallet commands also
 *    read balances and submit transactions the person signed on this machine. No key is ever sent to
 *    one of these. A wrong shard count produces a blob id the storage network refuses, so it fails
 *    loudly at the relay rather than quietly storing something unreadable.
 *
 * ⭐ 2026-10-21 — THE SAME LIST AS THE BROWSER'S, AND A NEW ONE. Sui removed JSON-RPC from its node
 *    software in October 2026; the JSON-RPC mirrors this table held were dead (testnet) or about to be
 *    (mainnet). Every host below answered chain id, a balance, an object and the gas price over
 *    gRPC-web that morning. Two operators per network — Suiscan and Mysten Labs — in the browser's
 *    order (`web/src/lib/walrus/network-hosts.ts` says why mainnet keeps Suiscan first). A test
 *    and `deploy/check-walrus-hosts.mjs` hold this table to the browser's. Since 2026-11-10 (D51)
 *    mainnet adds 01NODE and PublicNode (Allnodes) after those two, measured answering.
 */
export const SUI_RPC_HOSTS: Readonly<Record<string, readonly string[]>> = {
  testnet: ["https://fullnode.testnet.sui.io", "https://rpc-testnet.suiscan.xyz"],
  mainnet: [
    "https://rpc-mainnet.suiscan.xyz",
    "https://fullnode.mainnet.sui.io",
    "https://sui.01.ro",
    "https://sui-grpc-web.publicnode.com",
  ],
};

/** How long one host gets before it is given up. A read that stalls is a read that failed. */
export const READ_TIMEOUT_MS = 60_000;

/** How long the race waits for an answer before it asks the next host as well (D51). */
export const READ_HEDGE_MS = 1_500;

/** At most this many hosts waiting at once, hanging ones included. */
const READ_MAX_IN_FLIGHT = 12;

/** A host that sends no headers in this long is given up, so hanging hosts do not hold the race. */
const READ_HEADER_TIMEOUT_MS = 20_000;

/** This many 404s, and no other answer, mean the bytes are not there; asking dozens more says the same. */
const NOT_FOUND_QUORUM = 3;

// Re-exported so every caller still finds them here; the names themselves live in a module with no
// imports, because `nmts --help` prints them (`env-vars.ts`).
export { AGGREGATOR_ENV_VAR, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./env-vars.ts";

/**
 * The relay this run writes through: the caller's if it named one, then the environment's, then
 * the network's.
 *
 * ⛔ THE CALLER COMES FIRST AND IS READ ON EVERY HOST. A library's caller has no environment to
 *    write, and until this order existed the `relay` option was answered by the browser host alone
 *    — so a program on a server named a relay and its bytes went to the public one, silently.
 */
export function relayHost(network: string): string {
  const named = reach().relay?.trim() || runtime().env(RELAY_ENV_VAR)?.trim();
  if (named) return named;
  const known = RELAY_HOSTS[network]?.[0];
  if (known === undefined) {
    throw new NmtsError(`No upload relay is known for the ${network} storage network.`, {
      nextStep: `Name one in ${RELAY_ENV_VAR} to upload anyway.`,
    });
  }
  return known;
}

/**
 * Every Sui node this run may ask (it must answer gRPC-web), in order: the caller's list if it named one, then the
 * environment's, then the network's.
 *
 * ⛔ Naming nodes REPLACES the list rather than adding to it — the same rule the aggregator
 *    override follows, and for the same reason: somebody who names a node is saying *those*, and
 *    quietly reaching a public mirror instead would send their traffic somewhere they did not
 *    choose.
 *
 * ⚠ THE CALLER MAY NAME SEVERAL AND A VARIABLE MAY NAME ONE. The failover below is the same
 *   either way; a single name is a list of one.
 */
export function suiRpcHosts(network: string): readonly string[] {
  const asked = reach().suiRpc?.map((h) => h.trim()).filter((h) => h !== "");
  if (asked !== undefined && asked.length > 0) return asked;
  const named = runtime().env(SUI_RPC_ENV_VAR)?.trim();
  if (named) return [named];
  const hosts = SUI_RPC_HOSTS[network];
  if (hosts === undefined || hosts.length === 0) {
    throw new NmtsError(`No Sui RPC endpoint is known for the ${network} network.`, {
      nextStep: `Name one in ${SUI_RPC_ENV_VAR} to upload anyway.`,
    });
  }
  return hosts;
}

/** The node whose address gets RECORDED — the first one, since that is the one normally asked. */
export function suiRpcHost(network: string): string {
  return suiRpcHosts(network)[0] ?? "";
}

/**
 * What a storage-network client talks to the storage nodes through, spread into its options.
 *
 * ⚠ THIS TOOL DOES NOT NORMALLY REACH A STORAGE NODE — it writes through an upload relay and reads
 *   through an aggregator. The option is filled anyway, because the one path that fell back to a
 *   node directly would be a request going round whatever the caller asked every request to go
 *   through, and the whole worth of that option is that there is no exception to it.
 *
 * ⛔ HERE RATHER THAN IN EACH CLIENT. Five of them are built in this package; five copies of the
 *    same line is five places for the sixth to be forgotten.
 */
export function storageNodesThrough(): { storageNodeClientOptions: { fetch: typeof fetch } } {
  return { storageNodeClientOptions: { fetch: reachFetch } };
}


function fromEnvironment(): readonly string[] | null {
  const raw = runtime().env(AGGREGATOR_ENV_VAR);
  if (raw === undefined) return null;
  const hosts = raw.split(",").map((h) => h.trim()).filter((h) => h !== "");
  return hosts.length > 0 ? hosts : null;
}

export interface ReadOptions {
  /** Override the host list — for a development stack, or an aggregator somebody runs themselves. */
  hosts?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  /**
   * Read only these bytes: inclusive start, EXCLUSIVE end. Absent reads the whole object.
   *
   * ⛔ IT IS A REQUEST, NOT A GUARANTEE. An aggregator is free to ignore `Range` and answer 200
   *    with everything, so what comes back is cut to the asked-for length here. Without that cut
   *    the one caller that uses this — the rebuild's 72-byte key check — would quietly become a
   *    download of the whole account.
   */
  range?: { start: number; end: number };
}

/**
 * Which aggregators this read may ask, in order: the ones this call named, then the ones the
 * caller named for the client, then the environment's, then the network's.
 *
 * ⚠ THE CLIENT'S CHOICE IS NEW HERE. A caller that named aggregators used to be honoured only on
 *   the reads that carry a host list down as an argument; the rest of the package quietly went to
 *   the public ones, which is the same defect `relay` had.
 */
function hostsFor(network: string, options: ReadOptions): { hosts: readonly string[]; named: boolean } {
  if (options.hosts !== undefined && options.hosts.length > 0) return { hosts: options.hosts, named: true };
  const asked = reach().aggregators;
  if (asked !== undefined && asked.length > 0) return { hosts: asked, named: true };
  const chosen = fromEnvironment();
  if (chosen !== null) return { hosts: chosen, named: true };
  const known = AGGREGATOR_HOSTS[network];
  if (known === undefined) {
    throw new NmtsError(`No storage-network hosts are known for "${network}".`, {
      exitCode: 2,
      nextStep: "Use --network mainnet or --network testnet.",
    });
  }
  return { hosts: known, named: false };
}

/**
 * Fetch one stored object: the hosts as a staggered race, then the storage nodes themselves (D51).
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
  node?: { kind: "blob" | "patch"; id: string },
): Promise<Uint8Array> {
  const { hosts, named } = hostsFor(network, options);
  const tried: string[] = [];
  const raced = await readRace(hosts, pathOf, options, tried);
  if (raced !== null) return raced;
  const notFound = tried.filter((t) => t.endsWith("→ 404")).length;
  const sawOther = tried.length > notFound;
  // ⭐ D51: the storage nodes, when no aggregator served the bytes for a reason other than "not
  //    found". Not when somebody named the hosts: naming them says "those", as above.
  if (node !== undefined && !named && sawOther && options.signal?.aborted !== true) {
    try {
      const bytes = await (await import("./node-read.ts")).readFromNodes(network, node.kind, node.id);
      const range = options.range;
      return range === undefined ? bytes : bytes.subarray(range.start, Math.min(range.end, bytes.length));
    } catch (error) {
      tried.push(`the storage nodes → ${error instanceof Error ? error.message : "no answer"}`);
    }
  }
  throw new NmtsError(`${what} could not be read from the ${network} storage network.`, {
    exitCode: 5,
    nextStep:
      `Tried: ${tried.join(", ")}. If every host answered 404, either the bytes are gone or ` +
      `this is the wrong network. The same identifier does not exist on both.`,
  });
}

/**
 * Ask every host for one object as a staggered race (`read-race.ts`) and return the first body.
 *
 * ⛔ The reason each host failed is kept, not flattened to "failed". A timeout and a refused
 *    connection mean different things, and the reasons are what the person reads.
 */
function readRace(
  hosts: readonly string[],
  pathOf: (host: string) => string,
  options: ReadOptions,
  tried: string[],
): Promise<Uint8Array | null> {
  const overall = AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS);
  const reason = (error: unknown) => (error instanceof Error ? error.message : "no answer");
  return raceHosts(
    hosts,
    async (host, signal): Promise<Reply> => {
      const url = pathOf(host.replace(/\/$/, ""));
      try {
        const response = await reachFetch(url, {
          signal: AbortSignal.any([signal, overall]),
          redirect: "follow",
          ...headersFor(options),
        });
        if (response.ok) return { response };
        tried.push(`${host} → ${response.status}`);
        void response.body?.cancel();
        return response.status === 404 ? "not-found" : "failed";
      } catch (error) {
        // A host stopped because another one answered first is not a failure worth reporting.
        if (!(signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "AbortError")) {
          tried.push(`${host} → ${reason(error)}`);
        }
        return "failed";
      }
    },
    async (host, response) => {
      try {
        const body = new Uint8Array(await response.arrayBuffer());
        const range = options.range;
        if (range === undefined) return body;
        const want = range.end - range.start;
        // A 206 already holds exactly the asked-for bytes; a 200 holds the object from byte zero.
        if (body.length === want) return body;
        if (body.length < range.end) throw new Error(`answered ${body.length} bytes for a ${want}-byte range`);
        return body.subarray(range.start, range.end);
      } catch (error) {
        tried.push(`${host} → ${reason(error)}`);
        throw error;
      }
    },
    {
      hedgeMs: READ_HEDGE_MS,
      maxInFlight: READ_MAX_IN_FLIGHT,
      headerTimeoutMs: READ_HEADER_TIMEOUT_MS,
      notFoundQuorum: NOT_FOUND_QUORUM,
      signal: options.signal,
    },
  );
}

/** The `Range` header for a partial read, or nothing at all for a whole one. */
function headersFor(options: ReadOptions): { headers?: Record<string, string> } {
  const range = options.range;
  if (range === undefined) return {};
  // HTTP ranges are inclusive at both ends; this one is exclusive at the end.
  return { headers: { Range: `bytes=${range.start}-${range.end - 1}` } };
}

/** Whole-blob read: `GET {aggregator}/v1/blobs/{blobId}`. */
export function readBlob(network: string, blobId: string, options: ReadOptions = {}): Promise<Uint8Array> {
  return readFrom(
    network,
    (host) => `${host}/v1/blobs/${encodeURIComponent(blobId)}`,
    `Blob ${blobId}`,
    options,
    { kind: "blob", id: blobId },
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
    { kind: "patch", id: patchId },
  );
}
