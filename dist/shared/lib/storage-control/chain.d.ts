/**
 * The slice of a Sui RPC client this file uses. Structural on purpose: the browser hands in its
 * Walrus-extended client and the command-line tool its plain JSON-RPC client, and neither has to
 * be named here.
 */
export interface StorageChainReader {
    getObject(input: {
        id: string;
        options: {
            showType: true;
        };
    }): Promise<{
        data?: {
            type?: string | null;
        } | null;
    }>;
    getOwnedObjects(input: {
        owner: string;
        filter: {
            StructType: string;
        };
        options: {
            showContent: true;
        };
        cursor?: string;
    }): Promise<{
        data?: readonly unknown[] | null;
        hasNextPage?: boolean;
        nextCursor?: string | null;
    }>;
}
/** One storage resource — the chain's `Storage { id, start_epoch, end_epoch, storage_size }` as is. */
export interface StorageResource {
    /** The Sui object id. */
    readonly objectId: string;
    /** The epoch from which this resource can be used. */
    readonly startEpoch: number;
    /** The epoch at which it ends. */
    readonly endEpoch: number;
    /** How much it can hold AFTER encoding, in bytes. ⚠ Not a plaintext size. */
    readonly sizeBytes: number;
}
/**
 * This network's storage-resource type name, derived from the system object.
 *
 * ⛔ `showType` only — the content is not needed, and asking for it returns a large answer.
 */
export declare function readStorageType(client: StorageChainReader, systemObjectId: string): Promise<string>;
/** One object response as a storage resource. A different shape gives null — it quietly leaves the list. */
export declare function toStorageResource(node: unknown): StorageResource | null;
/**
 * Every storage resource this address holds.
 *
 * ⚠ Follows the pages to the end. Reading only the first would show a person with many resources
 *   SOME OF THEM AS IF THEY WERE ALL, which is a worse lie than "none".
 */
export declare function readOwnedStorage(client: StorageChainReader, owner: string, storageType: string, maxPages?: number): Promise<StorageResource[]>;
