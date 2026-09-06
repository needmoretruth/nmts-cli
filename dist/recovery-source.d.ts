/** `file_parts.storage_kind` for a quilt patch. 0 is a dedicated blob. */
export declare const STORAGE_QUILT = 1;
/** One stored piece of a file, as the server describes it. */
export interface SourcePart {
    part_index: number;
    storage_kind: number;
    /** Storage-network code. Absent means Walrus — a fact, not a fallback. */
    network?: number;
    blob_id: string;
    patch_id?: string;
    /** What the part OCCUPIES: the sealed stream, header and tags included. */
    sealed_len: number;
    sui_object_id?: string;
    /**
     * What this part's stored header DECLARES — the plaintext length behind `sealed_len`.
     *
     * ⚠ DERIVED HERE, NOT SENT: the server is told what a part occupies and nothing about the file
     *   behind it. ⛔ NOT the file's own length either — a padded part declares more than the file
     *   holds, and the real per-part lengths come from `keepLengths`.
     */
    streamPlaintextLen: number;
}
/** One stored file in the dump. It says what is stored, never how it is arranged. */
export interface SourceItem {
    id: string;
    size: number;
    /** Wrapped file key. The one thing here that cannot be recreated if it is lost. */
    dekWrapped?: string;
    /** Sealed whole-file content hash, when the file was committed with one. */
    contentHashCt?: string;
    createdAt: string;
    updatedAt: string;
    parts: SourcePart[];
}
export interface SourceWalkOptions {
    server: string;
    apiKey: string;
    /** base64url of the 32-byte proof. Sent on every page. */
    accountProof: string;
    /** Ticks while paging, so a very large account does not look frozen. */
    onProgress?: ((loaded: number) => void) | undefined;
}
/**
 * Read every page of the dump, oldest cursor first.
 *
 * ⛔ A REPEATED CURSOR IS A REFUSAL, NOT A LOOP. The cursor is server-issued and strictly
 *    increasing, but a bug — or a hand-edited answer — that repeated one would spin here forever
 *    with nothing to show for it.
 */
export declare function readAllRecoverySource(options: SourceWalkOptions): Promise<SourceItem[]>;
