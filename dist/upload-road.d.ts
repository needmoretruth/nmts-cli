/** Where the own relay answers, after the NMTS server's address. */
export declare const OWN_RELAY_PATH = "/v1/relay";
/** The part size on the own road: an existing preset, the size whose relay peak fits the server. */
export declare const OWN_RELAY_PART_BYTES: number;
/** How long Mysten's relay gets to answer before this run takes the own road. */
export declare const ROAD_PROBE_TIMEOUT_MS = 10000;
/** True for the own relay's address on any NMTS server. */
export declare function isOwnRelay(relayUrl: string): boolean;
/**
 * Decide this run's road, once, before anything is priced. True when the own road was taken.
 *
 * `probe` is the request that asks Mysten's relay (tests pass a fake one).
 */
export declare function chooseUploadRoad(input: {
    network: string;
    server: string;
    apiKey: string;
    probe?: typeof fetch;
    timeoutMs?: number;
}): Promise<boolean>;
/** Forget the choice (tests; a library caller between runs). */
export declare function resetUploadRoad(): void;
/** The relay this run writes through: the own one when it was chosen, else the usual one. */
export declare function uploadRelay(network: string): string;
/** The part size a fresh upload uses: unchanged on Mysten's road, at most 64 MiB on ours. */
export declare function partSizeForRoad(partSize: number): number;
/**
 * The fetch the relay client uses. On the own road it carries this account's key, and while another
 * upload holds the relay (503 with `Retry-After`) it waits and asks again until the SDK's own
 * timeout ends it. On Mysten's road it is `inner` unchanged.
 */
export type RelayFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
export declare function relayFetch(relayUrl: string, inner: RelayFetch, sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>): RelayFetch;
