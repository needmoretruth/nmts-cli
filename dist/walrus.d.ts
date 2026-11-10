/**
 * Curated Walrus aggregator (read) endpoints per network, preference order.
 *
 * ⭐ 2026-09-22: a SECOND one per network, so "if one is down we move on" is true rather than
 *    written. Both came from the canonical operator registry (https://docs.wal.app/operators.json)
 *    and both answered `GET /v1/api` with 200 the same day. The browser's table carries the full
 *    provenance and the reason each host and not another; this copy exists because this package
 *    imports nothing from that tree, and `deploy/check-walrus-hosts.mjs` set-compares the two.
 */
export declare const PINNED_AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>>;
/**
 * ⭐ D51: the two rows above, then every other aggregator in Walrus's operator registry that served
 *    the probe blob (`deploy/gen-roads.mjs`, the same generated list the browser and its CSP read).
 *    A read asks them as a staggered race, so a dead row costs a second and a half, not a timeout.
 */
export declare const AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>>;
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
export declare const RELAY_HOSTS: Readonly<Record<string, readonly string[]>>;
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
export declare const SUI_RPC_HOSTS: Readonly<Record<string, readonly string[]>>;
/** How long one host gets before it is given up. A read that stalls is a read that failed. */
export declare const READ_TIMEOUT_MS = 60000;
/** How long the race waits for an answer before it asks the next host as well (D51). */
export declare const READ_HEDGE_MS = 1500;
export { AGGREGATOR_ENV_VAR, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./env-vars.ts";
/**
 * The relay this run writes through: the caller's if it named one, then the environment's, then
 * the network's.
 *
 * ⛔ THE CALLER COMES FIRST AND IS READ ON EVERY HOST. A library's caller has no environment to
 *    write, and until this order existed the `relay` option was answered by the browser host alone
 *    — so a program on a server named a relay and its bytes went to the public one, silently.
 */
export declare function relayHost(network: string): string;
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
export declare function suiRpcHosts(network: string): readonly string[];
/** The node whose address gets RECORDED — the first one, since that is the one normally asked. */
export declare function suiRpcHost(network: string): string;
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
export declare function storageNodesThrough(): {
    storageNodeClientOptions: {
        fetch: typeof fetch;
    };
};
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
    range?: {
        start: number;
        end: number;
    };
}
/** Whole-blob read: `GET {aggregator}/v1/blobs/{blobId}`. */
export declare function readBlob(network: string, blobId: string, options?: ReadOptions): Promise<Uint8Array>;
/**
 * Quilt-patch read: `GET {aggregator}/v1/blobs/by-quilt-patch-id/{patchId}`.
 *
 * A quilt is one stored blob holding many small files; the patch id addresses one of them. Files
 * under 64 MiB share a quilt, so this is the common path rather than the exotic one.
 */
export declare function readQuiltPatch(network: string, patchId: string, options?: ReadOptions): Promise<Uint8Array>;
