/** One blob, or one file inside a quilt, read and decoded from the storage nodes. */
export declare function readFromNodes(network: string, kind: "blob" | "patch", id: string): Promise<Uint8Array>;
