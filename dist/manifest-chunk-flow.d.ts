import { type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { type ManifestIndexV2 } from "./shared/lib/drive/manifest-chunks.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
import { type HeldChunk } from "./shared/lib/drive/manifest-pack.ts";
import type { AccountSettings } from "./shared/lib/drive/manifest-settings.ts";
/** A list this machine could not read completely. Never rendered as an empty or shorter drive. */
export declare class ManifestChunkError extends NmtsError {
    constructor(message: string);
}
/** Everything the chunk half of one account's list needs. The key is the caller's to zero. */
export interface ChunkIO {
    server: string;
    apiKey: string;
    accountId: string;
    crypt: CryptoGlue;
    /** The file-list key (NCF-3 §1.2). Derived, used and zeroed by the caller. */
    key: Uint8Array;
}
/**
 * Fetch, verify and open every chunk the index names, four at a time.
 *
 * The result is in INDEX order, which is placement order (§6.3.3), so the list arrives sorted for
 * free. Afterwards the machine's own copies are pruned to what this index names: everything else
 * is a version nobody will ask for again.
 */
export declare function openChunks(io: ChunkIO, index: ManifestIndexV2): Promise<HeldChunk[]>;
/** What one save of the list is made of. `prev` is absent only for the very first version. */
export interface ListWritePlan {
    /** The chunks behind the version this save was built on. Empty converts a version-1 list. */
    previous: readonly HeldChunk[];
    entries: readonly ManifestEntry[];
    /** The version being written — one past the one that was read. */
    seq: number;
    /** Hash of the sealed blob this one continues, version 1's included (§6.3.6). */
    prev?: string;
    settings: AccountSettings;
    /** What the compare-and-swap is made against. `null` means "I believe none exists yet". */
    baseSeq: number | null;
}
export interface ListWriteResult {
    /** The version the server says is now current. */
    seq: number;
    /** The sealed INDEX, base64url — the bytes this machine keeps as its copy. */
    ct: string;
    /** The chunks behind that index, for a caller that goes on to write again. */
    held: HeldChunk[];
}
/**
 * Write these entries as version 2: the chunks that changed, then the index that names them all.
 *
 * ⛔ ONLY WHAT CHANGED IS SENT. The packer compares the new entries against the chunks the read
 *    handed over and keeps every chunk whose contents came through untouched, so a rename uploads
 *    one chunk instead of the whole list. That is the entire point of this format version.
 *
 * ⚠ A LOST COMPARE-AND-SWAP COMES BACK AS ITSELF. The caller re-reads and re-applies its intent;
 *   the chunks written by the losing attempt are named by no index and the server sweeps them.
 */
export declare function writeChunkedList(io: ChunkIO, plan: ListWritePlan): Promise<ListWriteResult>;
/**
 * The chunk names a sealed index carries, or an empty list when these bytes are not one.
 *
 * ⛔ A ROLLBACK NEEDS THIS AND NOTHING ELSE FROM INSIDE THE LIST. Writing an index back as the
 *    current version without naming its chunks would let the server free them as unreferenced, and
 *    the restored list would open into a drive missing files. So the bytes are opened far enough
 *    to read the names, and no further.
 *
 * ⚠ BYTES THAT WILL NOT OPEN ANSWER "no chunks", which is the request `rollback` has always made.
 *   A list that does not open cannot be told apart from a version-1 one without opening it, and
 *   refusing here would refuse in a case the command used to handle.
 */
export declare function namedChunks(code: string, ct: string): Promise<string[]>;
/**
 * The sealed chunks a kept index names, from this machine's own copies alone.
 *
 * Null means the kept bytes are a version-1 list, which carries its entries itself and needs
 * nothing beside it. A refusal means this machine holds the index but not everything it names, so
 * what could be written out would be an incomplete list — worse than none, because somebody would
 * keep it for years believing they were covered.
 */
export declare function keptChunks(code: string, accountId: string, indexCt: string): Promise<string[] | null>;
