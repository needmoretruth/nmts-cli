/**
 * The slice of a Sui client this file uses — its core API (`client.core`), which the gRPC and GraphQL
 * clients both carry. Structural on purpose: the browser hands in its Walrus-extended client and the
 * command-line tool its plain one, and neither has to be named here.
 *
 * ⛔ 2026-10-21 — this used to be JSON-RPC's `getObject` / `getOwnedObjects`, which Sui retired. The
 *    core API answers the same two questions; the object's fields now come as the node's JSON
 *    rendering of the struct (`json`), with no `content.fields` wrapper.
 */
export interface StorageChainReader {
    core: {
        getObject(input: {
            objectId: string;
        }): Promise<{
            object: {
                type: string;
            };
        }>;
        listOwnedObjects(input: {
            owner: string;
            type: string;
            include: {
                json: true;
            };
            cursor?: string | null;
        }): Promise<{
            objects: readonly unknown[];
            hasNextPage: boolean;
            cursor: string | null;
        }>;
    };
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
 * ⛔ The type only — the content is not needed, and asking for it returns a large answer.
 */
export declare function readStorageType(client: StorageChainReader, systemObjectId: string): Promise<string>;
/** One listed object as a storage resource. A different shape gives null — it quietly leaves the list. */
export declare function toStorageResource(node: unknown): StorageResource | null;
/**
 * Every storage resource this address holds.
 *
 * ⚠ Follows the pages to the end. Reading only the first would show a person with many resources
 *   SOME OF THEM AS IF THEY WERE ALL, which is a worse lie than "none".
 */
export declare function readOwnedStorage(client: StorageChainReader, owner: string, storageType: string, maxPages?: number): Promise<StorageResource[]>;
