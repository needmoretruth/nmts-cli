/** Curated Walrus aggregator (read) endpoints per network, preference order. */
export declare const AGGREGATOR_HOSTS: Readonly<Record<string, readonly string[]>>;
/**
 * Curated Walrus upload-relay (write) endpoints per network, preference order.
 *
 * ⛔ A RELAY IS NOT AN AGGREGATOR, and the difference is money. The relay is named inside the
 *    register transaction the server pays a tip in, so the bytes have to go to the SAME host the
 *    reservation was made for. That is why a write picks its host BEFORE the storage is bought and
 *    then never moves: failing over to a second relay would push bytes nobody paid that relay for.
 */
export declare const RELAY_HOSTS: Readonly<Record<string, readonly string[]>>;
/**
 * Sui JSON-RPC endpoints per network — public mirrors, because the official full nodes retired
 * JSON-RPC on both networks (browser measurements 2026-07-29 testnet, 2026-08-03 mainnet).
 *
 * ⛔ READ-ONLY, AND NOT TRUSTED WITH ANYTHING. This tool asks one question here: how many shards
 *    the storage network currently has, which the erasure coding needs. A wrong answer produces a
 *    blob id the storage network refuses, so it fails loudly at the relay rather than quietly
 *    storing something unreadable. No key is ever sent to one of these, and nothing is signed.
 *
 * ⭐ 2026-09-01 — a LIST per network, two operators, first-that-answers. It used to be one host,
 *    and the testnet one was measured dead that morning: `rpc-testnet.suiscan.xyz` completes the
 *    TCP handshake in 31 ms and then sends nothing for 12 seconds, three times running. It had
 *    been that way for eleven days, so every `nmts` command that needed the shard count on testnet
 *    simply stopped. Each host below answered `sui_getChainIdentifier` with the right value the
 *    same morning, 8/8 on a burst.
 */
export declare const SUI_RPC_HOSTS: Readonly<Record<string, readonly string[]>>;
/** How long one host gets before the next is tried. A read that stalls is a read that failed. */
export declare const READ_TIMEOUT_MS = 60000;
/**
 * Point reads at somebody else's aggregator, or at a development stack.
 *
 * ⚠ It replaces the list rather than adding to it, and that is deliberate: a run should read from
 *   where it was told to read, not from there AND the public hosts. Comma-separated for more
 *   than one, tried in the order given.
 */
export declare const AGGREGATOR_ENV_VAR = "NMTS_AGGREGATOR";
/**
 * Push writes through somebody else's relay, or through a development stack.
 *
 * ⚠ ONE host, not a list. Unlike reads there is nothing to fail over to — see `RELAY_HOSTS`.
 */
export declare const RELAY_ENV_VAR = "NMTS_RELAY";
/** Ask a different Sui JSON-RPC node the shard-count question. */
export declare const SUI_RPC_ENV_VAR = "NMTS_SUI_RPC";
/** The relay this run writes through: the environment's if it named one, else the network's. */
export declare function relayHost(network: string): string;
/**
 * Every Sui JSON-RPC node this run may ask, in order.
 *
 * ⛔ Naming one in the environment REPLACES the list rather than adding to it — the same rule the
 *    aggregator override follows, and for the same reason: somebody who names a node is saying
 *    *that one*, and quietly reaching a public mirror instead would send their traffic somewhere
 *    they did not choose.
 */
export declare function suiRpcHosts(network: string): readonly string[];
/** The node whose address gets RECORDED — the first one, since that is the one normally asked. */
export declare function suiRpcHost(network: string): string;
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
