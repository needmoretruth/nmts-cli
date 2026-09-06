import { type ManifestEntry } from "./manifest-codec.ts";
import { type ManifestIndex } from "./manifest-index.ts";
/**
 * The marker an entry gets when its parent chain does not reach the drive root.
 *
 * U+FFFF is a permanent noncharacter, so no name can contain it and it sorts after every assigned
 * character in both code-point and UTF-16 order. That is what puts "placed after every entry that
 * can be resolved" (§6.3.3) INSIDE the key, where any comparator honours it.
 */
export declare const UNRESOLVED_MARK = "\uFFFF";
/**
 * One chunk as the packer decided it.
 *
 * `reuse` is a chunk's existing name: present when its entry set came through an edit untouched,
 * so the flow can name it in the new index without writing a byte. Absent means "seal these
 * entries and write them".
 */
export interface PackedChunk {
    reuse?: string;
    items: readonly ManifestEntry[];
    /** Placement key of the first entry. */
    f: string;
    /** Placement key of the last entry. */
    l: string;
}
/** A chunk this device currently holds open, as the flow read it out of the index. */
export interface HeldChunk {
    /** Its name — the hash the index gave it. */
    h: string;
    f: string;
    l: string;
    items: readonly ManifestEntry[];
}
/**
 * The placement key of one entry: its folder path from the drive root, each segment the folder's
 * plaintext name, then the entry's own name, joined by `/`.
 *
 * Trashed entries keep the key they had — the trash is a mark on an entry, not a place — so
 * nothing here reads `deletedAt`.
 */
export declare function placementKey(entry: ManifestEntry, index: ManifestIndex): string;
/**
 * Compare two placement keys BY CODE POINT, as §6.3.3 requires.
 *
 * JavaScript's own `<` compares UTF-16 code units, which puts an astral character (U+10000 and up,
 * stored as a surrogate pair starting at U+D800) BEFORE U+E000–U+FFFF instead of after it. That is
 * a different order from the one the format specifies, so keys carrying a surrogate take the exact
 * path; everything else takes the fast one, which is the same order for those strings.
 */
export declare function comparePlacementKeys(a: string, b: string): number;
/**
 * Pack every entry from scratch, in key order, closing a chunk when the next entry would push its
 * plaintext past the bound. Used for the first save of an account and for the version-1
 * conversion (§6.3.6).
 */
export declare function packAll(entries: readonly ManifestEntry[]): PackedChunk[];
/**
 * The minimal rewrite: keep every chunk whose entries came through the edit untouched, rewrite the
 * ones that changed, split what grew past the bound and merge what shrank under half of it.
 *
 * An entry stays in the chunk that held it only while its key is still inside that chunk's range.
 * A move between folders changes the key, so it leaves as a removal and arrives as an addition —
 * which is exactly the "at most two chunks" §6.3.3 describes.
 */
export declare function repack(previous: readonly HeldChunk[], entries: readonly ManifestEntry[]): PackedChunk[];
