/** What a PieceCID can be computed over: bytes in memory, a Blob (read as a stream), or a stream. */
export type PieceSource = Uint8Array | Blob | ReadableStream<Uint8Array>;
/** Bytes a single Filecoin piece may carry at least, and at most (the storage companies' limit). */
export declare const PIECE_MIN_BYTES = 127;
export declare const PIECE_MAX_BYTES = 1065353216;
/** The PieceCID of `source`, in its string form (`bafkzcib…`). */
export declare function pieceCidOf(source: PieceSource): Promise<string>;
/**
 * A pass-through stream that computes the PieceCID of whatever flows through it.
 *
 * For a caller that already streams the part somewhere and wants the id from the same read. The
 * `result` settles once the stream is closed.
 */
export declare function pieceCidTransform(): Promise<{
    transform: TransformStream<Uint8Array, Uint8Array>;
    result: Promise<string>;
}>;
/**
 * Whether a string is a well-formed PieceCID, and the raw byte size it names.
 *
 * Used to check what a server hands back before trusting it as the id of our bytes. `null` means
 * the string is not a PieceCID at all.
 */
export declare function pieceSizeOf(cid: string): Promise<number | null>;
