/** Where the own relay answers, after the NMTS server's address. */
export declare const OWN_RELAY_PATH = "/v1/relay";
/** The part size on the own road: an existing preset, the size whose relay peak fits the server. */
export declare const OWN_RELAY_PART_BYTES: number;
/** How long Mysten's relay gets to answer before this run takes the own road. */
export declare const ROAD_PROBE_TIMEOUT_MS = 10000;
/**
 * The "relay address" of the direct road: no host, the storage nodes themselves (D51). The same
 * value as the browser's (`web/src/lib/walrus/node-road.ts`), and it is what a resumable upload's
 * record keeps, so a resumed part goes back to the nodes.
 */
export declare const NODE_ROAD = "walrus:storage-nodes";
/** True for the direct road. */
export declare function isNodeRoad(relayUrl: string): boolean;
/** True for a road that takes no tip: the own relay and the storage nodes. */
export declare function isTipFree(relayUrl: string): boolean;
/** True for the own relay's address on any NMTS server. */
export declare function isOwnRelay(relayUrl: string): boolean;
/**
 * Decide this run's road, once, before anything is priced. True when a small road (the storage
 * nodes, or the own relay) was taken.
 *
 * `probe` is the request that asks Mysten's relay (tests pass a fake one). `nodeRoad: false` is a
 * machine that cannot write to the storage nodes itself; it goes to the own relay, as before D51.
 */
export declare function chooseUploadRoad(input: {
    network: string;
    server: string;
    apiKey: string;
    probe?: typeof fetch;
    timeoutMs?: number;
    nodeRoad?: boolean;
    /** A wallet upload: the person pays the tip, so the other company relays may carry it. */
    otherCompanies?: boolean;
    /** A credit upload: the other company relays may carry it while their tip fits the credit ceiling. */
    credit?: boolean;
}): Promise<boolean>;
/**
 * The own relay to try when a direct write failed, with the fetch that carries this account's key,
 * or null when this run did not choose the small roads (a named relay, or Mysten's).
 */
export declare function ownRelayFallback(): string | null;
/** Forget the choice (tests; a library caller between runs). */
export declare function resetUploadRoad(): void;
/** The road this run writes through: the storage nodes or the own relay when chosen, else the usual relay. */
export declare function uploadRelay(network: string): string;
/** The part size a fresh upload uses: unchanged on Mysten's road, at most 64 MiB on the small roads. */
export declare function partSizeForRoad(partSize: number): number;
/**
 * The fetch the relay client uses. On the own road it carries this account's key, and while another
 * upload holds the relay (503 with `Retry-After`) it waits and asks again until the SDK's own
 * timeout ends it. On Mysten's road it is `inner` unchanged.
 */
export type RelayFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
export declare function relayFetch(relayUrl: string, inner: RelayFetch, sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>): RelayFetch;
