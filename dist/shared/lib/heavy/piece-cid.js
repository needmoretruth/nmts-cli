// The Filecoin piece id (PieceCID, FRC-0069) of one sealed part.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// WHAT IT IS. A PieceCID names bytes by the root of a binary Merkle tree over their FR32-padded form,
// plus how much padding the tree needed and its height (`bafkzcib…`). The storage company checks the
// bytes it received against it, and the chain records it. We do not implement the tree: it comes
// from `@filoz/synapse-core/piece`, the library the Filecoin Onchain Cloud tooling itself uses.
//
// ⛔ LOADED ONLY WHEN SOMEBODY STORES ON FILECOIN. The library is imported dynamically on first use,
//    so a program (or a browser page) that never touches NMTS Heavy never loads it.
//
// ⚠ THE BYTES ARE READ ONCE MORE. Computing the id is a full pass over the part (seconds for half a
//   gigabyte); uploading is a second pass. The id is needed before the upload starts, because the
//   server places the part only once it knows exactly what the part is.
/** Bytes a single Filecoin piece may carry at least, and at most (the storage companies' limit). */
export const PIECE_MIN_BYTES = 127;
export const PIECE_MAX_BYTES = 1_065_353_216;
/** The PieceCID of `source`, in its string form (`bafkzcib…`). */
export async function pieceCidOf(source) {
    const { calculate } = await import("./synapse-piece.js");
    return (await calculate(source)).toString();
}
/**
 * A pass-through stream that computes the PieceCID of whatever flows through it.
 *
 * For a caller that already streams the part somewhere and wants the id from the same read. The
 * `result` settles once the stream is closed.
 */
export async function pieceCidTransform() {
    const { transformStream } = await import("./synapse-piece.js");
    const { transform, result } = transformStream();
    return { transform, result: result.then((cid) => cid.toString()) };
}
/**
 * Whether a string is a well-formed PieceCID, and the raw byte size it names.
 *
 * Used to check what a server hands back before trusting it as the id of our bytes. `null` means
 * the string is not a PieceCID at all.
 */
export async function pieceSizeOf(cid) {
    const { tryFrom } = await import("./synapse-piece.js");
    const piece = tryFrom(cid);
    if (piece === null)
        return null;
    try {
        return piece.size;
    }
    catch {
        // The library refuses a size past the safe-integer range. No part NMTS stores is near it, so
        // such a string is not the id of our bytes, whatever else it may be.
        return null;
    }
}
