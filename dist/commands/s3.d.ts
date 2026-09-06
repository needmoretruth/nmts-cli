/** MinIO's port, which is what most S3 tools already have in their examples. */
export declare const DEFAULT_PORT = 9000;
/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts.
 */
export declare const LIST_CACHE_MS = 5000;
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
export declare function s3(options?: S3Options): Promise<number>;
