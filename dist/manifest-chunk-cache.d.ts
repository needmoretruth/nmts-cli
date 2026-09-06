/** The sealed bytes this machine holds under that name, or null when it holds none. */
export declare function readCachedChunk(accountId: string, hash: string): string | null;
/** Keep these sealed bytes under that name. Silent when the machine will not take them. */
export declare function writeCachedChunk(accountId: string, hash: string, ct: string): void;
/**
 * Drop every copy this account holds that the given list does not name.
 *
 * ⛔ THIS IS THE BOUND ON THE CACHE, and it is a set rather than a size or an age. A chunk the
 *    current list does not name is a version of the list nobody will ask for again — no timer can
 *    say that, and a size limit would evict a chunk the list still needs while keeping one it
 *    abandoned. Called after every complete read and every successful write, which is exactly when
 *    "what the list names" is known.
 */
export declare function pruneChunkCache(accountId: string, keep: ReadonlySet<string>): void;
